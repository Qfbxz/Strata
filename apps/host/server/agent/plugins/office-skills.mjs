/**
 * The built-in Office skills: Word, PowerPoint, and Excel workflows ported from the upstream
 * assistant harness's office skill pack and rewritten for what a Strata assistant has — shell
 * tools and file tools, a plain Python on the machine, and LibreOffice (`soffice`) for page
 * previews, PDF export, and spreadsheet recalculation. Each item carries {id, name, description,
 * body}; the server's skills() list adds source, enabled, triggers, and sizeKb when it spreads
 * them into the bundled catalog.
 */

const word = `Create, read, edit, and validate Word documents (.docx) with python-docx. Run every Python step with the shell tool in the task workspace, and use the file tools to read what a step writes.

Check the library first: \`python3 -c "import docx"\`. If it is missing, tell the person what is missing and ask before installing anything. Keep scripts, intermediate files, and final documents in the workspace. Name scripts for their task, such as \`edit_docx.py\`; never \`docx.py\` or \`inspect.py\`, which shadow the libraries they import. Use the user's requested language, and keep an existing document's design unless a redesign was asked for.

## Create and edit

For text edits, find the target by its text or position and inspect only its runs and formatting. A title can be an ordinary paragraph without a Title style or a document-property title. Update the relevant runs; assigning a paragraph's \`.text\` destroys run formatting. Save a new file unless an in-place edit was requested. Read other structures only when the edit involves them — rebuilding a document can lose features python-docx does not support.

Use paragraph styles for headings and body text. Size tables for the section that contains them, and account for merged cells and nested tables. Chinese, Japanese, and Korean text may need an explicit \`w:eastAsia\` font assignment in addition to \`run.font.name\`; a font name alone does not guarantee the glyphs exist or how the text renders.

A new document:

\`\`\`python
from docx import Document

document = Document()
document.add_heading("Project report", level=0)
document.add_paragraph("Summary", style="Heading 1")
document.add_paragraph("The requested findings go here.")
document.save("report.docx")
\`\`\`

python-docx does not paginate or render documents. Do not present ordinary replacement, colored text, or comments as tracked changes. When real revisions or OOXML features python-docx does not support matter, preserve their package parts and verify the requested operation instead of silently discarding it. When writing package parts directly, create a new ZIP and copy each unchanged member once; appending a replacement member duplicates its name and corrupts the package.

## Check and deliver

Reopen the saved document with python-docx and verify the requested content, the related formatting, and the unchanged content that must be preserved. Deliver only after these checks pass. Investigate package-level details only for a concrete failure, an ambiguous edit target, an unsupported feature, or an explicit user requirement.

A new file, or a content edit with incidental basic formatting such as bold headers or number formats, needs no extra steps. When the request is about appearance — styling, font color, spacing, sizing, or text alignment — render the changed page and inspect it, unless the user explicitly skips rendering. If the session cannot read images, or LibreOffice is not installed, say the visual check was skipped and finish the content checks. Convert the saved file, then the wanted pages:

    soffice --headless --convert-to pdf --outdir . report.docx
    pdftoppm -png -f 1 -l 3 report.pdf

Read the images with the file tools and check clipping, alignment, headings, table widths, and contrast. For PDF output alone, run only the first command and check the result: nonempty output that starts with \`%PDF-\`. LibreOffice's rendering can differ from Word's.

Deliver by naming the final file's workspace path. Keep the file in place, and leave intermediate scripts and check reports out of the delivery unless they were requested.`;

const pptx = `Create, read, edit, and validate PowerPoint presentations (.pptx) with python-pptx. Run every Python step with the shell tool in the task workspace, and use the file tools to read what a step writes.

Check the library first: \`python3 -c "import pptx"\`. If it is missing, tell the person what is missing and ask before installing anything. Keep scripts and output files in the workspace, and name scripts for their task, such as \`edit_pptx.py\`; never \`pptx.py\`, \`inspect.py\`, or \`zipfile.py\`. Match the requested slide language, and keep a supplied presentation's design when editing it.

## Create and edit

Use python-pptx to inspect or modify an existing presentation. Inspect slide layouts, text runs, images, tables, and charts before editing. Change only the requested content, preserve mixed text formatting, and save to a new file unless an in-place edit was requested. Rebuilding slides can discard animations, SmartArt, or other content python-pptx does not support.

For a new deck, build editable text, tables, and charts. Use local image files rather than network image URLs, and set slide dimensions, text sizes, and chart data explicitly:

\`\`\`python
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches, Pt

presentation = Presentation()
presentation.slide_width = Inches(13.333)
presentation.slide_height = Inches(7.5)
slide = presentation.slides.add_slide(presentation.slide_layouts[6])
title = slide.shapes.add_textbox(Inches(0.6), Inches(0.4), Inches(12), Inches(0.8))
run = title.text_frame.paragraphs[0].add_run()
run.text = "Quarterly report"
run.font.size = Pt(30)
data = CategoryChartData()
data.categories = ["Q1", "Q2"]
data.add_series("Revenue", [12, 18])
slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,
                       Inches(0.8), Inches(1.6), Inches(11.5), Inches(4.8), data)
presentation.save("report.pptx")
\`\`\`

Use \`Inches\` or \`Cm\` for positions and sizes and \`Pt\` for font sizes. To edit a generated title while keeping the rest of the deck:

\`\`\`python
from pptx import Presentation

presentation = Presentation("report.pptx")
for shape in presentation.slides[0].shapes:
    if shape.has_text_frame and shape.text == "Quarterly report":
        shape.text_frame.paragraphs[0].runs[0].text = "Quarterly results"
presentation.save("report-edited.pptx")
\`\`\`

Check that text and images fit the slide dimensions, that titles form a useful sequence, and that chart labels agree with the source values. Paragraph alignment does not move a text box: when a title must be centered on the slide, center both its paragraph and the text box against \`presentation.slide_width\`, then reopen and verify both. A native chart's embedded workbook is part of the deliverable and must hold the intended data. Library support for writing PPTX is not a rendering engine and does not guarantee every PowerPoint feature survives editing.

## Check and deliver

Reopen the saved presentation with python-pptx and verify the requested slide count, content, formatting, chart data, and notes, including unchanged content that must be preserved. These checks do not establish text fit, readable contrast, or rendering fidelity.

Deliver after the requested edits are verified. A new file, or an edit with incidental basic formatting, needs no extra steps. When the request is about appearance — styling, spacing, sizing, or alignment — render the changed slides and inspect them, unless the user explicitly skips rendering. If the session cannot read images, or LibreOffice is not installed, say the visual check was skipped and finish the content checks:

    soffice --headless --convert-to pdf --outdir . report-edited.pptx
    pdftoppm -png -f 1 -l 3 report-edited.pdf

Read the images with the file tools and check clipping, alignment, contrast, and chart labels. For PDF output alone, run only the first command and check for nonempty output that starts with \`%PDF-\`. LibreOffice's rendering can differ from PowerPoint's.

Deliver by naming the final file's workspace path. Keep the file in place, and leave intermediate images and reports out of the delivery unless they were requested.`;

const xlsx = `Read, create, edit, and validate Excel workbooks and formulas (.xlsx) with openpyxl, with pandas for data analysis. Run every Python step with the shell tool in the task workspace, and use the file tools to read what a step writes.

Check the libraries first: \`python3 -c "import openpyxl, pandas"\`. If one is missing, tell the person what is missing and ask before installing anything. Keep scripts, working files, and outputs in the workspace, and name scripts for their task, such as \`edit_xlsx.py\`; never \`openpyxl.py\`, \`pandas.py\`, or \`inspect.py\`. Save to a new workbook unless an in-place edit was requested.

## Read and modify

Use openpyxl for existing workbooks and targeted cell or style changes. Load with \`data_only=False\` when formulas must survive. Inspect sheet names, the affected cell types, formulas, styles, merged ranges, and referenced ranges before editing.

Use pandas for data analysis and transformations. A DataFrame is not the workbook: exporting it over an existing file can lose sheets, formulas, charts, and formatting. Write analysis results back to the intended ranges with openpyxl. XlsxWriter can create new workbooks but cannot read or modify existing ones.

A new workbook:

\`\`\`python
from openpyxl import Workbook
from openpyxl.styles import Font

workbook = Workbook()
sheet = workbook.active
sheet.title = "Revenue"
for row in [("Quarter", "Revenue"), ("Q1", 12), ("Q2", 18), ("Total", "=SUM(B2:B3)")]:
    sheet.append(row)
for cell in sheet[1]:
    cell.font = Font(bold=True)
sheet.column_dimensions["A"].width = 18
sheet.column_dimensions["B"].width = 18
workbook.save("report.xlsx")
\`\`\`

Preserve numbers, dates, booleans, and identifiers as the intended cell types; formatting is not a type conversion. For modifications, \`openpyxl.load_workbook("input.xlsx", data_only=False)\`, change the requested ranges, save a separate result, and avoid a DataFrame round trip when workbook features must survive.

Writing a formula does not calculate it. openpyxl and XlsxWriter never evaluate formulas, and \`data_only=True\` returns cached values that may be absent or stale. When calculated results must be refreshed, re-save the workbook through LibreOffice:

    soffice --headless --convert-to xlsx --outdir recalculated report.xlsx

LibreOffice follows its recalculation-on-load setting, so verify the new file with openpyxl opened both ways: formulas survive with \`data_only=False\`, and with \`data_only=True\` the cached results match the requested logic and the expected totals. If the caches are still stale, compute the expected values in pandas for the answer, keep the workbook as it is, and say the stored results could not be refreshed. Never replace requested formulas with constants or present stale values as freshly calculated ones.

Do not rename \`.xls\`, \`.xlsb\`, encrypted, or macro-enabled files to \`.xlsx\`; they need an appropriate supported operation. \`keep_vba=True\` preserves VBA package content in an XLSM workflow but does not execute or edit macros, and it does not guarantee advanced workbook features survive. Keep the original and verify such requirements explicitly.

## Check and deliver

Reopen the saved workbook with openpyxl and verify the requested sheet names, values, types, formulas, styles, and totals against the source data, including unchanged content that must be preserved. These checks do not calculate formulas or judge appearance.

A new workbook, or a data or formula edit with incidental basic formatting such as bold headers or number formats, needs no extra steps. When the user's primary task is appearance — cell fill colors, text alignment, spacing, or sizing — render the affected sheet and inspect it, unless the user explicitly skips rendering. If the session cannot read images, or LibreOffice is not installed, say the visual check was skipped and finish the data checks:

    soffice --headless --convert-to pdf --outdir . report.xlsx
    pdftoppm -png -f 1 -l 2 report.pdf

For PDF output alone, run only the first command and check for nonempty output that starts with \`%PDF-\`. Spreadsheet pages follow the workbook's print settings; change those only when asked.

Deliver after the requested data checks pass: name the final workbook's workspace path and keep the file in place.`;

/** The three built-in Office skills, ready to spread into the bundled skill catalog. */
export function officeSkills() {
  return [
    { id: 'office-word', name: 'Word documents', description: 'Creates, edits and validates Word documents (.docx) with python-docx, with a check list before delivery.', body: word },
    { id: 'office-pptx', name: 'PowerPoint presentations', description: 'Creates, edits and validates PowerPoint presentations (.pptx) with python-pptx, with a check list before delivery.', body: pptx },
    { id: 'office-xlsx', name: 'Excel workbooks', description: 'Reads, creates, edits and validates Excel workbooks and formulas (.xlsx) with openpyxl, and refreshes formula results with LibreOffice.', body: xlsx },
  ];
}
