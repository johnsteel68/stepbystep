# Decorative cutting designs

Two additional designs derived from official Google Fonts, with original TTF
files and SIL OFL licenses retained in their respective directories:

- Oleo Script Bold: calligraphic capitals with generous curves.
- Abril Fatface: contrasting editorial display capitals.

The original fonts are not modified. The application uses generated cutting
contours with reinforced bridges and previews those exact contours in its
font picker. Import only additions to preserve existing project geometry:

```sh
node --experimental-strip-types scripts/prepare-google-stencils.mjs --only=oleoscript,abrilfatface
```

Minimum heights use the existing conservative per-design factor and thickness
checks. Oleo requires larger lettering than Abril; these are not replacements
for the small-letter Micro designs. This is a geometry screen, not workshop
certification of every stroke or laser setting.

The full alphabet and digits are tested for retained-metal connectivity, plus
sharing, validation, margins and bend protection. Candidate designs Lobster,
Pattaya, Fugaz One, Righteous, Berkshire Swash, Spicy Rice, Chela One and
Hammersmith One failed these tests. Bowlby One failed the importer's minimum
feature screen. None of those candidates is offered in the selector.

Pinned source revision, checksums and licenses: `PROVENANCE-additions.json`.
