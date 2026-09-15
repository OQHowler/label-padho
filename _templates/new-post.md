---
# =====================================================================
#  NEW REVIEW TEMPLATE  (one post = one snack product)
#
#  1. Copy this whole file into the _posts folder.
#  2. Name it:  YYYY-MM-DD-product-name.md   e.g.  2026-10-02-maggi-masala.md
#     Use lowercase letters, numbers and hyphens only.
#
#  PERMANENT NUMBER: don't add post_id or permalink yourself. When you commit,
#  GitHub gives the review the next free number (No. 1, No. 2, ...) and writes
#  it at the top of this file. The page address (/posts/12/), votes and views
#  all belong to that number, so you can safely rename the file or change the
#  title and product name later. If the number is edited or deleted, GitHub
#  puts it back.
#  3. Fill in the fields, then write your review under the closing ---
#
#  RULES THAT PREVENT BUILD ERRORS
#  - Put text in "double quotes", especially if it contains : or #
#  - Indent with spaces, never tabs
#  - verdict and flag must be exactly: good, okay or bad
#  - Posts dated in the future stay hidden until that date
#  - Delete any optional block you don't need
# =====================================================================

# ---------- Required ----------
title: "Your headline for the review"
date: 2026-10-02 10:00:00 +0530
product: "Product name"               # e.g. "Maggi 2-Minute Masala Noodles"
brand: "Brand name"                   # e.g. "Nestlé"
snack_type: "Instant noodles"         # used for grouping; spell it the SAME way every time
verdict: bad                          # good | okay | bad
score: 3                              # whole number 1-10 (good 7-10, okay 4-6, bad 1-3)
description: "One or two sentences. Shown on cards, in the verdict box and in Google results."

# ---------- Optional: pack photo ----------
# Upload the photo to assets/images/ first, then remove the # signs below.
# Write the path WITHOUT your baseurl.
# image: "/assets/images/product-name.jpg"
# image_alt: "Front of the pack"

# ---------- Optional: pack details ----------
pack_size: "70 g"
price: "₹15"
label_checked: "October 2026"

# ---------- Optional: ingredients, in the order printed on the pack ----------
# flag (good / okay / bad) and note are optional for each ingredient.
ingredients:
  - name: "Ingredient 1"
    flag: bad
    note: "Short reason"
  - name: "Ingredient 2"
    flag: okay
  - name: "Ingredient 3"

# ---------- Optional: nutrition panel ----------
# sub: true indents a row under the one above.
# flag (good / okay / bad) adds a coloured dot next to the value.
nutrition_basis: "Per 100 g"
nutrition:
  - name: "Energy"
    value: "000 kcal"
  - name: "Total fat"
    value: "0 g"
  - name: "Saturated fat"
    value: "0 g"
    sub: true
    flag: bad
  - name: "Sodium"
    value: "0 mg"
nutrition_note: "Values as printed on the pack."

# ---------- Optional: quick summary boxes ----------
good_points:
  - "Point"
bad_points:
  - "Point"
---

Write your review here.
