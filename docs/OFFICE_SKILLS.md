# Office skills

The assistant ships with three built-in skills for Office files: Word documents, PowerPoint
presentations, and Excel workbooks. They are always in the Skills list — no install, no setup.
Switch one off in **Settings → Assistant → Skills** if you do not want it.

Each skill is a checklist the assistant follows. It writes a small Python script, runs it with
its shell tool, checks the saved file by opening it again, and only then hands you the result.
The Word skill uses `python-docx`, the PowerPoint skill uses `python-pptx`, and the Excel skill
uses `openpyxl`. Page previews, PDF export, and spreadsheet recalculation use LibreOffice
(`soffice`) when it is on your machine; if it is missing, the assistant says so and finishes
the content checks without the visual part.

## Word documents (`office-word`)

Makes new `.docx` files and edits existing ones: text, headings, tables, styles, and East
Asian fonts. It checks the saved file with python-docx before delivering, and renders a page
when the request is about how things look. It also turns a document into a PDF.

Trigger it with any Word request: "make", "edit", "fix", or "convert" a `.docx`.

- "Write a one-page project report as a Word file with two headings."
- "Change the title in report.docx to Quarterly results and keep the rest as it is."
- "Turn report.docx into a PDF."

## PowerPoint presentations (`office-pptx`)

Builds slide decks with editable text, tables, and charts, and edits existing decks without
rebuilding them — so animations and other PowerPoint features survive. It checks slide count,
content, and chart data by reopening the file, and renders slides when fit or alignment
matters. It also exports a deck to PDF.

Trigger it with any slides request: a `.pptx` to make or change.

- "Build a five-slide deck about the Q3 numbers, 16:9, with a bar chart."
- "Replace the title on slide 1 and leave every other slide alone."
- "Export the deck to PDF."

## Excel workbooks (`office-xlsx`)

Reads, creates, and edits `.xlsx` files: values, types, styles, merged cells, and formulas.
It edits cells with openpyxl instead of rewriting the workbook, so sheets, charts, and
formatting survive. It refreshes formula results with LibreOffice and says plainly when it
could not. It refuses risky shortcuts: no renaming `.xls` or macro files to `.xlsx`, and no
replacing formulas with constants.

Trigger it with any spreadsheet request: a `.xlsx` to make, fix, or extend.

- "Make a small budget workbook with a SUM total and bold headers."
- "Add a Revenue column to sheet 1 and keep the formulas in the other sheets."
- "The totals in this workbook are stale — recalculate them."

## Notes

- New files and plain data edits skip the preview steps; requests about looks (colors, spacing,
  alignment) get a rendered page check when LibreOffice is installed.
- The skills keep your files in place. Intermediate scripts stay out of the delivery unless you
  ask for them.
