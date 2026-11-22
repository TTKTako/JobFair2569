# CPSK Job Fair 2569 – booth map

A static website (HTML, CSS, vanilla JS – no build step, no dependencies).
Students tap a booth on the floor plan, or search by booth number, company name or job title,
to see each company's employment types, years of study, open positions and requirements.

## Project structure

```
public/
  index.html      page markup
  styles.css      all styles
  app.js          floor plan, search, filters, detail panel
  data.csv        booth data (the only file you need to edit)
  favicon.svg
  fonts/          self-hosted Bai Jamjuree + IBM Plex Sans Thai (SIL Open Font License)
vercel.json       tells Vercel to serve the public/ folder
```

## Deploy on Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Leave Framework Preset as **Other**. `vercel.json` already sets the output directory to `public`,
   so no build command is needed. Click **Deploy**.

If you remove `vercel.json`, set **Output Directory** to `public` in the project settings instead.

## Run locally

The page loads `data.csv` with `fetch`, so open it through a local server (not by double-clicking):

```
python3 -m http.server 8000 -d public
# or: npx serve public
```

Then visit http://localhost:8000

## Updating data.csv

`public/data.csv` has one row per booth with these columns (the site finds them by header name):

| Column | Source |
|---|---|
| หมายเลขบูธ / Booth | booth number 1–35 from the floor plan |
| ชื่อบริษัท (ไทย) / Company Name (Thai) | Thai name shown on the site |
| ชื่อบริษัท (อังกฤษ) / Company Name (English) | English name shown on the site |
| ประเภทการจ้างงานที่เปิดรับ / Employment Types Offered | form column J |
| ชั้นปีที่ท่านสนใจเปิดรับ / Year of Study You Are Interested In | form column K |
| ตำแหน่งงานที่ต้องการรับ / Positions You Are Hiring For | form column L |
| คุณสมบัติที่ต้องการ / Requirements | form column M |
| ลิงก์รายละเอียดตำแหน่งงาน / Job Description Link | form column N – shown as a button that opens in a new tab |

- Personal data from the Google Form (submitter email, contact name, contact email, phone number)
  and internal fields (timestamp, attendance, number of staff, booth requests, acknowledgement,
  suggestions) have been removed for PDPA. Do not add them back – this file is public.
- The job link button only appears when the cell holds a full `http://` or `https://` address.
- Positions are split into a list at commas and new lines (commas inside brackets are kept).
- Requirements keep their line breaks; lines starting with `-` or `•` become bullets and `**text**` becomes bold.
- Booths 7 (Kichi Team) and 33 (Innovative Extremist) have not submitted the confirmation form yet,
  so their J–M cells are empty and the site shows "no details yet". Fill them in or delete the rows later.
- Save the file as UTF-8 (CSV UTF-8 in Excel) so Thai text stays readable.

## Deep links

Every booth has its own link, e.g. `https://your-site.vercel.app/#booth-22`.
Selecting a booth updates the address bar, so the link can be shared or printed as a QR code at the booth.

## Fonts

Bai Jamjuree and IBM Plex Sans Thai are licensed under the SIL Open Font License 1.1
(license files are in `public/fonts/`).
