/* =====================================================================
   Label Padho: site script
   - Anonymous visit tracking          (every page)
   - Upvote / downvote + view count    (review pages)
   - Most upvoted / most viewed        (home page)
   - Search, filters, sorting, stats   (all reviews page)
   - Dashboard                         (/stats/)

   Everything that needs Supabase switches itself off when the URL or key
   in _config.yml is empty, so the site always works without it.
   ===================================================================== */
(function () {
  "use strict";

  /* ---------- Config & helpers ---------- */

  function readJSON(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  var config = readJSON("lp-config") || {};
  var siteData = readJSON("lp-posts") || { verdicts: {}, posts: [] };
  var posts = siteData.posts || [];
  var verdicts = siteData.verdicts || {};

  var SUPABASE_URL = String(config.supabaseUrl || "").trim().replace(/\/+$/, "");
  var SUPABASE_KEY = String(config.supabaseKey || "").trim();
  var apiEnabled = /^https:\/\//.test(SUPABASE_URL) && SUPABASE_KEY.length > 0;

  function validId(v) { var n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 1000000000 ? n : null; }
  var numberFormat = (window.Intl && Intl.NumberFormat) ? new Intl.NumberFormat("en-IN") : null;

  function fmt(n) {
    n = Number(n) || 0;
    return numberFormat ? numberFormat.format(n) : String(n);
  }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { /* storage blocked: carry on without it */ }
    return null;
  }

  function makeUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var visitorId = store("lp-visitor-id");
  if (!visitorId || !UUID_RE.test(visitorId)) {
    visitorId = makeUUID();
    store("lp-visitor-id", visitorId);
  }

  function rpc(name, body) {
    var headers = { "Content-Type": "application/json", "apikey": SUPABASE_KEY };
    // Legacy JWT "anon" keys also need the Authorization header.
    // New sb_publishable_ keys must NOT be sent there.
    if (SUPABASE_KEY.indexOf("eyJ") === 0) headers["Authorization"] = "Bearer " + SUPABASE_KEY;
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {})
    }).then(function (res) {
      if (!res.ok) throw new Error(name + " failed with status " + res.status);
      return res.text();
    }).then(function (text) {
      return text ? JSON.parse(text) : null;
    });
  }

  // All lookups use the permanent review number, never the name.
  function postById() {
    var map = {};
    posts.forEach(function (p) { var id = validId(p.id); if (id) map[id] = p; });
    return map;
  }

  function allIds() {
    return posts.map(function (p) { return validId(p.id); }).filter(Boolean);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function verdictMark(key) {
    var data = verdicts[key] || {};
    var wrap = el("span", "mark mark--" + (verdicts[key] ? key : "okay"));
    var sym = el("span", "mark__sym");
    sym.setAttribute("aria-hidden", "true");
    var textWrap = el("span", "mark__text");
    textWrap.appendChild(el("span", "mark__label", data.label || ""));
    wrap.appendChild(sym);
    wrap.appendChild(textWrap);
    return wrap;
  }

  function isExcluded() { return store("lp-exclude") === "1"; }

  /* ---------- 1. Visit tracking ---------- */

  function shouldTrack() {
    if (!apiEnabled || config.noTrack || isExcluded()) return false;
    var host = window.location.hostname;
    var local = host === "localhost" || host === "127.0.0.1" || host === "" || host === "[::1]";
    if (local && !config.trackLocalhost) return false;
    if (/bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(navigator.userAgent || "")) return false;
    return true;
  }

  function referrerHost() {
    try {
      if (!document.referrer) return null;
      var host = new URL(document.referrer).hostname.toLowerCase();
      return host && host !== window.location.hostname.toLowerCase() ? host : null;
    } catch (e) { return null; }
  }

  function currentPath() {
    var path = window.location.pathname || "/";
    path = path.replace(/\/index\.html$/, "/");
    return path.slice(0, 300);
  }

  var currentId = validId(config.postId);

  // Resolves when the visit is saved (or skipped), so counts shown afterwards include it.
  var visitRecorded = shouldTrack()
    ? rpc("record_view", {
        p_path: currentPath(),
        p_post_id: currentId,
        p_visitor_id: visitorId,
        p_referrer_host: referrerHost()
      }).catch(function (err) { console.warn("[Label Padho] visit not recorded:", err.message); })
    : Promise.resolve();

  /* ---------- 2. Review page: votes & views ---------- */

  (function reviewPage() {
    var widgets = Array.prototype.slice.call(document.querySelectorAll("[data-vote]"));
    if (!apiEnabled || !currentId || widgets.length === 0) return;

    var state = { upvotes: 0, downvotes: 0, my_vote: 0, views: 0 };
    var busy = false;
    var viewsWrap = document.querySelector("[data-post-views]");
    var viewsCount = document.querySelector("[data-post-views-count]");

    function render(message) {
      widgets.forEach(function (w) {
        w.hidden = false;
        w.querySelector('[data-vote-count="up"]').textContent = fmt(state.upvotes);
        w.querySelector('[data-vote-count="down"]').textContent = fmt(state.downvotes);
        Array.prototype.forEach.call(w.querySelectorAll("[data-vote-value]"), function (btn) {
          var value = Number(btn.getAttribute("data-vote-value"));
          btn.setAttribute("aria-pressed", state.my_vote === value ? "true" : "false");
          btn.disabled = busy;
        });
        var status = w.querySelector("[data-vote-status]");
        if (status && message !== undefined) status.textContent = message;
      });
      if (viewsWrap && viewsCount) {
        viewsCount.textContent = fmt(state.views);
        var unit = viewsWrap.querySelector("[data-post-views-unit]");
        if (unit) unit.textContent = state.views === 1 ? "view" : "views";
        viewsWrap.hidden = false;
      }
    }

    function apply(data) {
      if (!data) return;
      state.upvotes = Number(data.upvotes) || 0;
      state.downvotes = Number(data.downvotes) || 0;
      state.my_vote = Number(data.my_vote) || 0;
      if (data.views !== undefined) state.views = Number(data.views) || 0;
    }

    function vote(value) {
      if (busy) return;
      var next = state.my_vote === value ? 0 : value;
      var previous = { upvotes: state.upvotes, downvotes: state.downvotes, my_vote: state.my_vote, views: state.views };

      // Optimistic update so the click feels instant.
      if (state.my_vote === 1) state.upvotes -= 1;
      if (state.my_vote === -1) state.downvotes -= 1;
      if (next === 1) state.upvotes += 1;
      if (next === -1) state.downvotes += 1;
      state.my_vote = next;
      busy = true;
      render("");

      rpc("cast_vote", { p_post_id: currentId, p_voter_id: visitorId, p_value: next })
        .then(function (data) {
          apply(data);
          busy = false;
          render(next === 1 ? "Upvoted. Thanks!" : next === -1 ? "Downvoted. Thanks for the honesty." : "Vote removed.");
        })
        .catch(function () {
          state = previous;
          busy = false;
          render("Your vote couldn't be saved. Check your connection and try again.");
        });
    }

    widgets.forEach(function (w) {
      Array.prototype.forEach.call(w.querySelectorAll("[data-vote-value]"), function (btn) {
        btn.addEventListener("click", function () { vote(Number(btn.getAttribute("data-vote-value"))); });
      });
    });

    visitRecorded
      .then(function () { return rpc("get_post_stats", { p_post_id: currentId, p_voter_id: visitorId }); })
      .then(function (data) { apply(data); render(""); })
      .catch(function (err) { console.warn("[Label Padho] stats unavailable:", err.message); });
  })();

  /* ---------- Shared: stats for all posts ---------- */

  var allStatsPromise = null;
  function loadAllStats() {
    if (!allStatsPromise) {
      allStatsPromise = visitRecorded.then(function () {
        return rpc("get_posts_stats", { p_post_ids: allIds() });
      }).then(function (data) {
        var map = {};
        ((data && data.posts) || []).forEach(function (s) { var id = validId(s.post_id); if (id) map[id] = s; });
        return { total: (data && data.total_views) || 0, byId: map };
      });
    }
    return allStatsPromise;
  }

  function fillCardStats(stats) {
    Array.prototype.forEach.call(document.querySelectorAll(".card[data-post-id]"), function (card) {
      var s = stats.byId[validId(card.getAttribute("data-post-id"))];
      var box = card.querySelector("[data-card-stats]");
      if (!s || !box) return;
      box.querySelector("[data-card-up]").textContent = fmt(s.upvotes);
      box.querySelector("[data-card-views]").textContent = fmt(s.views);
      var unit = box.querySelector("[data-card-views-unit]");
      if (unit) unit.textContent = Number(s.views) === 1 ? "view" : "views";
      box.hidden = false;
    });
  }

  /* ---------- 3. Home page: leaderboards ---------- */

  (function homePage() {
    var boards = document.querySelector("[data-leaderboards]");
    var totalRow = document.querySelector("[data-total-views-row]");
    if (!apiEnabled || (!boards && !totalRow) || posts.length === 0) return;

    if (boards) boards.hidden = false;
    var lookup = postById();

    function renderList(listEl, items, statKey, unit, emptyText) {
      listEl.innerHTML = "";
      listEl.removeAttribute("aria-busy");
      if (items.length === 0) {
        listEl.appendChild(el("li", "rank__empty", emptyText));
        return;
      }
      items.forEach(function (s, i) {
        var post = lookup[s.post_id];
        var li = el("li", "rank__item review--" + (verdicts[post.verdict] ? post.verdict : "okay"));
        li.appendChild(el("span", "rank__pos", String(i + 1)));
        var body = el("div", "rank__body");
        var link = el("a", "rank__name", post.product);
        link.href = post.url;
        body.appendChild(link);
        var sub = [post.brand, post.snackType].filter(Boolean).join(", ");
        if (sub) body.appendChild(el("span", "rank__sub", sub));
        li.appendChild(body);
        li.appendChild(verdictMark(post.verdict));
        var stat = el("span", "rank__stat");
        stat.appendChild(el("strong", "", fmt(s[statKey])));
        stat.appendChild(document.createTextNode(" " + unit + (Number(s[statKey]) === 1 ? "" : "s")));
        li.appendChild(stat);
        listEl.appendChild(li);
      });
    }

    loadAllStats().then(function (stats) {
      if (totalRow) {
        totalRow.querySelector("[data-total-views]").textContent = fmt(stats.total);
        totalRow.hidden = false;
      }
      fillCardStats(stats);
      if (!boards) return;

      var list = Object.keys(stats.byId)
        .filter(function (id) { return lookup[id]; })
        .map(function (id) { return stats.byId[id]; });

      var byVotes = list.filter(function (s) { return s.upvotes > 0; })
        .sort(function (a, b) {
          return (b.upvotes - a.upvotes) || ((b.upvotes - b.downvotes) - (a.upvotes - a.downvotes)) || (b.views - a.views);
        }).slice(0, 3);

      var byViews = list.filter(function (s) { return s.views > 0; })
        .sort(function (a, b) { return (b.views - a.views) || (b.upvotes - a.upvotes); })
        .slice(0, 3);

      renderList(boards.querySelector('[data-rank="upvotes"]'), byVotes, "upvotes", "upvote", "No votes yet. Open a review and be the first.");
      renderList(boards.querySelector('[data-rank="views"]'), byViews, "views", "view", "No views counted yet.");
    }).catch(function (err) {
      console.warn("[Label Padho] leaderboards unavailable:", err.message);
      if (boards) boards.hidden = true;
    });
  })();

  /* ---------- 4. All reviews page: filters, search, sort ---------- */

  (function listingPage() {
    var list = document.querySelector("[data-post-list]");
    if (!list) return;

    var filterBar = document.querySelector("[data-filters]");
    var searchInput = document.getElementById("search");
    var typeSelect = document.getElementById("type");
    var sortSelect = document.getElementById("sort");
    var sortWrap = document.querySelector("[data-sort-wrap]");
    var verdictButtons = Array.prototype.slice.call(document.querySelectorAll("[data-filter-verdict]"));
    var countEl = document.querySelector("[data-count]");
    var emptyEl = document.querySelector("[data-empty]");
    var resetBtn = document.querySelector("[data-reset]");
    var cards = Array.prototype.slice.call(list.querySelectorAll(".card"));
    if (!filterBar || !searchInput || !typeSelect || !sortSelect) return;

    cards.forEach(function (c, i) { c.setAttribute("data-order", String(i)); });
    var lookup = postById();
    var stats = null;

    var validVerdicts = verdictButtons.map(function (b) { return b.getAttribute("data-filter-verdict"); });
    var validTypes = Array.prototype.map.call(typeSelect.options, function (o) { return o.value; });
    var validSorts = Array.prototype.map.call(sortSelect.options, function (o) { return o.value; });

    var params = new URLSearchParams(window.location.search);
    var state = {
      verdict: validVerdicts.indexOf(params.get("verdict")) > -1 ? params.get("verdict") : "all",
      type: validTypes.indexOf(params.get("type")) > -1 ? params.get("type") : "all",
      sort: validSorts.indexOf(params.get("sort")) > -1 ? params.get("sort") : "newest",
      q: (params.get("q") || "").trim()
    };

    function metric(card, key) {
      var id = validId(card.getAttribute("data-post-id"));
      if (key === "score") return Number((lookup[id] || {}).score) || 0;
      var s = stats && id && stats.byId[id];
      return s ? Number(s[key]) || 0 : 0;
    }

    function sortCards() {
      var sorted = cards.slice().sort(function (a, b) {
        var orderA = Number(a.getAttribute("data-order"));
        var orderB = Number(b.getAttribute("data-order"));
        if (state.sort === "newest") return orderA - orderB;
        return (metric(b, state.sort) - metric(a, state.sort)) || (orderA - orderB);
      });
      sorted.forEach(function (c) { list.appendChild(c); });
    }

    function render() {
      var query = state.q.toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var matches =
          (state.verdict === "all" || card.getAttribute("data-verdict") === state.verdict) &&
          (state.type === "all" || card.getAttribute("data-type") === state.type) &&
          (query === "" || (card.getAttribute("data-search") || "").indexOf(query) > -1);
        card.hidden = !matches;
        if (matches) shown += 1;
      });
      sortCards();

      verdictButtons.forEach(function (b) {
        b.setAttribute("aria-pressed", b.getAttribute("data-filter-verdict") === state.verdict ? "true" : "false");
      });
      if (countEl) countEl.textContent = shown + (shown === 1 ? " review" : " reviews");
      if (emptyEl) emptyEl.hidden = shown !== 0;

      var next = new URLSearchParams();
      if (state.verdict !== "all") next.set("verdict", state.verdict);
      if (state.type !== "all") next.set("type", state.type);
      if (state.sort !== "newest") next.set("sort", state.sort);
      if (state.q !== "") next.set("q", state.q);
      var qs = next.toString();
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
      }
    }

    // "Score" sorting works without Supabase; votes/views sorting needs it.
    if (!apiEnabled) {
      Array.prototype.slice.call(sortSelect.options).forEach(function (o) {
        if (o.value === "upvotes" || o.value === "views") o.remove();
      });
      if (state.sort === "upvotes" || state.sort === "views") state.sort = "newest";
    }
    if (sortWrap) sortWrap.hidden = false;

    searchInput.value = state.q;
    typeSelect.value = state.type;
    sortSelect.value = state.sort;
    filterBar.hidden = false;

    searchInput.addEventListener("input", function () { state.q = searchInput.value.trim(); render(); });
    typeSelect.addEventListener("change", function () { state.type = typeSelect.value; render(); });
    sortSelect.addEventListener("change", function () { state.sort = sortSelect.value; render(); });
    verdictButtons.forEach(function (b) {
      b.addEventListener("click", function () { state.verdict = b.getAttribute("data-filter-verdict"); render(); });
    });
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        state = { verdict: "all", type: "all", sort: state.sort, q: "" };
        searchInput.value = "";
        typeSelect.value = "all";
        render();
        searchInput.focus();
      });
    }

    render();

    if (apiEnabled && posts.length > 0) {
      loadAllStats().then(function (s) {
        stats = s;
        fillCardStats(s);
        render();
      }).catch(function (err) {
        console.warn("[Label Padho] stats unavailable:", err.message);
      });
    }
  })();

  /* ---------- 5. Stats dashboard ---------- */

  (function dashboard() {
    var root = document.querySelector("[data-dashboard]");
    if (!root) return;

    var off = root.querySelector("[data-dash-off]");
    var on = root.querySelector("[data-dash-on]");
    var status = root.querySelector("[data-dash-status]");
    var daysSelect = document.getElementById("dash-days");
    var refreshBtn = root.querySelector("[data-dash-refresh]");
    var excludeBtn = root.querySelector("[data-exclude-toggle]");
    var excludeText = root.querySelector("[data-exclude-text]");
    var lookup = postById();
    var byUrl = {};
    posts.forEach(function (p) { if (p.url) byUrl[p.url] = p; });
    var baseurl = String(config.baseurl || "");

    function renderExclude() {
      var excluded = isExcluded();
      excludeBtn.setAttribute("aria-pressed", excluded ? "true" : "false");
      excludeBtn.textContent = excluded ? "Start counting my visits" : "Stop counting my visits";
      excludeText.textContent = excluded
        ? "Visits and page views from this browser are not being counted."
        : "Your visits from this browser are currently being counted.";
    }
    excludeBtn.addEventListener("click", function () {
      store("lp-exclude", isExcluded() ? null : "1");
      renderExclude();
    });
    renderExclude();

    if (!apiEnabled) return;
    off.hidden = true;
    on.hidden = false;

    function rows(tbody, items, cols, emptyText) {
      tbody.innerHTML = "";
      if (!items.length) {
        var tr = el("tr");
        var td = el("td", "data-table__empty", emptyText);
        td.colSpan = cols;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
      }
      items.forEach(function (cells) {
        var tr = el("tr");
        cells.forEach(function (cell, i) {
          var td = el(i === 0 ? "th" : "td", i === 0 ? "" : "num");
          if (i === 0) td.scope = "row";
          if (cell && cell.nodeType) td.appendChild(cell); else td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    function prettyPath(path) {
      var post = byUrl[path];
      if (baseurl && path.indexOf(baseurl) === 0) path = path.slice(baseurl.length) || "/";
      return post ? "No. " + post.id + ": " + post.product : path;
    }

    function renderChart(daily) {
      var chart = root.querySelector("[data-chart]");
      var table = root.querySelector("[data-chart-table] tbody");
      chart.innerHTML = "";
      table.innerHTML = "";
      var max = daily.reduce(function (m, d) { return Math.max(m, d.views); }, 0);
      chart.style.setProperty("--bars", daily.length);
      var labelEvery = daily.length > 31 ? 14 : daily.length > 8 ? 5 : 1;

      daily.forEach(function (d, i) {
        var parts = d.day.split("-");
        var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        var label = date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

        var col = el("div", "chart__col");
        col.title = label + ": " + fmt(d.views) + " visits, " + fmt(d.visitors) + " readers";
        var bar = el("div", "chart__bar");
        bar.style.height = max ? (d.views / max * 100) + "%" : "0%";
        if (d.views > 0) bar.style.minHeight = "2px";
        col.appendChild(bar);
        var isLast = i === daily.length - 1;
        var showLabel = isLast || (i % labelEvery === 0 && daily.length - 1 - i >= labelEvery / 2);
        col.appendChild(el("span", "chart__label" + (isLast ? " chart__label--end" : ""), showLabel ? label : ""));
        chart.appendChild(col);

        var tr = el("tr");
        tr.appendChild(el("td", "", label));
        tr.appendChild(el("td", "", String(d.views)));
        tr.appendChild(el("td", "", String(d.visitors)));
        table.appendChild(tr);
      });
    }

    function load() {
      status.textContent = "Loading stats";
      refreshBtn.disabled = true;
      rpc("get_site_stats", { p_days: Number(daysSelect.value) || 30, p_post_ids: allIds() })
        .then(function (data) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-tile]"), function (t) {
            t.textContent = fmt(data[t.getAttribute("data-tile")]);
          });
          renderChart(data.daily || []);

          var postRows = (data.posts || [])
            .filter(function (s) { return lookup[s.post_id]; })
            .sort(function (a, b) { return (b.views - a.views) || (b.upvotes - a.upvotes); })
            .map(function (s) {
              var post = lookup[s.post_id];
              var a = el("a", "", "No. " + post.id + ": " + post.product);
              a.href = post.url;
              return [a, fmt(s.views), fmt(s.upvotes), fmt(s.downvotes)];
            });
          rows(root.querySelector("[data-dash-posts]"), postRows, 4, "No reviews published yet.");

          rows(root.querySelector("[data-dash-pages]"), (data.top_pages || []).map(function (p) {
            return [prettyPath(p.path), fmt(p.views), fmt(p.visitors)];
          }), 3, "No visits yet.");

          rows(root.querySelector("[data-dash-refs]"), (data.top_referrers || []).map(function (r) {
            return [r.host, fmt(r.views)];
          }), 2, "No outside websites yet. Direct visits aren't listed.");

          status.textContent = "Updated " + new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
        })
        .catch(function (err) {
          status.textContent = "Stats couldn't load. Check the Supabase URL and key in _config.yml, and that setup.sql was run. (" + err.message + ")";
        })
        .then(function () { refreshBtn.disabled = false; });
    }

    daysSelect.addEventListener("change", load);
    refreshBtn.addEventListener("click", load);
    load();
  })();
})();
