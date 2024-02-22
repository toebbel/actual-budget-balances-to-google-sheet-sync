require('dotenv').config()

const { google } = require('googleapis');
const api = require('@actual-app/api');

async function authorize() {
  return new google.auth.GoogleAuth({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // Assuming you have a service account
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function ensureSheetExists(auth, spreadsheetId, title) {
  const sheets = google.sheets({ version: 'v4', auth });
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = data.sheets.some(sheet => sheet.properties.title === title);
  
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title,
            },
          },
        }],
      },
    });
  }
}

async function updateSheet(auth, spreadsheetId, range, values) {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function getCurrentMonthData() {
  // Same as before
}

(async () => {
  await api.init({
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
  });

  // Same initialization and data preparation as before

  const auth = await authorize();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const accountsRange = process.env.ACCOUNTS_BALANCES_RANGE;
  const categoriesRange = process.env.CATEGORIES_DETAILS_RANGE;

  // Ensure or create the sheets based on the provided ranges
  const accountsSheetTitle = accountsRange.split('!')[0];
  const categoriesSheetTitle = categoriesRange.split('!')[0];
  await ensureSheetExists(auth, spreadsheetId, accountsSheetTitle);
  await ensureSheetExists(auth, spreadsheetId, categoriesSheetTitle);

  // Update sheets with the prepared data
  // Same as before
})().then(() => { console.log("Done"); process.exit(); }).catch(console.error);
