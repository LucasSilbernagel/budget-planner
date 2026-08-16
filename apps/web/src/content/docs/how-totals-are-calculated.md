## How totals are calculated

You enter amounts at whatever frequency you actually receive or pay them —
weekly, every two weeks, monthly, or yearly. Those numbers cannot be added
together as they stand: a weekly $100 and a yearly $100 are nothing like the
same amount of money. So Longhand converts every entry to one **common monthly
basis** first, adds the monthly figures together, and then re-expresses the
total at whichever period you have selected.

This page states that conversion exactly, so you can check any figure the app
shows against your own arithmetic.

### The conversion factors

Every amount is first converted to a **monthly** figure:

- **weekly** → × 52 ÷ 12 (about 4.3333 times a month)
- **every two weeks** (shown as **Bi-weekly** in the app) → × 26 ÷ 12 (about 2.1667
  times a month)
- **monthly** → × 1
- **yearly** → ÷ 12

The factors come from the calendar, not from a rule of thumb: there are 52 weeks
and 26 fortnights in a year, and 12 months. The familiar "about 4.33 weeks in a
month" is the *result* of 52 ÷ 12, not the definition.

To show a total at any period other than monthly, the monthly figure is
converted back by the **inverse** of the same factor:

- **yearly** = monthly × 12
- **weekly** = monthly × 12 ÷ 52
- **every two weeks** = monthly × 12 ÷ 26
- **monthly** = the monthly figure itself

That is why the period selector never changes what you entered, only how it is
expressed. Your entries are kept exactly as you typed them, at the frequency you
chose; the monthly figure is worked out from them each time a total is shown.

### The same maths as your spreadsheet

If you already keep a budget spreadsheet, this is **the same arithmetic you are
already doing**. Each of these pairs is algebraically identical:

- a yearly amount as a weekly figure: **yearly ÷ 52**
- a monthly amount as a weekly figure: **monthly × 12 ÷ 52**
- an every-two-weeks amount as a monthly figure: **every two weeks ÷ 2 × 52 ÷
  12**

So if one of your figures disagrees with Longhand's, the two are not using
different conversion models. Check the entries themselves — a missing row, a
duplicate, or an amount recorded at the wrong frequency — rather than looking
for a different formula. If the gap is only a few cents and every entry checks
out, it is the rounding described further down this page, not a mistake.

### A worked example

Three income entries at three different frequencies:

```
Salary     $2,000.00  every two weeks  →  2,000.00 × 26 ÷ 12  =  $4,333.33   (from 4,333.333…)
Freelance    $600.00  a month          →  600.00 × 1          =    $600.00
Dividend   $1,200.00  a year           →  1,200.00 ÷ 12       =    $100.00
                                       Monthly total          =  $5,033.33

Shown at the yearly view:  5,033.33 × 12                      = $60,399.96
Same figures in a spreadsheet: 2,000×26 + 600×12 + 1,200      = $60,400.00
                                                    difference =       4¢
```

Every figure there is what Longhand actually renders for those three entries.

### Why a few cents go missing

The four-cent gap above is not an error, and it has two separate causes worth
telling apart.

**Each entry is rounded to the nearest cent as it is converted** to its monthly
figure. The salary row above converts to $4,333.333…, which becomes
$4,333.33 — a third of a cent is dropped there and then. Over a long list those
fractions add up, so a total can end up a few cents away from what you would get
by rounding only once at the very end. The scale is small and bounded: **under
half a cent per entry at the monthly view, and under about six cents per entry at
the yearly view** (that half-cent, multiplied by 12).

**A breakdown is rounded separately from the total above it.** A category
breakdown adds up figures that have each been rounded already, while the headline
total is rounded once over everything. At the weekly and every-two-weeks views —
the two whose factors are not whole numbers — those two routes can land a cent or
two apart. At the monthly and yearly views they agree exactly, which is why you
only see that note on the other two. Where a breakdown can differ from the total
beside it, Longhand says so on the page rather than leaving you to find it.

This is also why a single **$100.00 yearly** entry shows as **$99.96** at the
yearly view: $100.00 ÷ 12 is $8.333…, which becomes $8.33, and $8.33 × 12 is
$99.96. The four cents are the rounding, not a lost payment. Longhand rounds this
way on purpose, and always from the same monthly figure, so a total is never
quietly recomputed a second way — the few cents you see are the ones described
here.

Still have a figure you cannot reconcile? Reach us through the
[contact form](/contact), or see the
[FAQ](/docs/faq) for the shorter version of this explanation.
