require('dotenv').config()

const fs = require('fs').promises;
const path = require('path');
const process = require('process');
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
  const currentMonth = await api.getBudgetMonth(new Date().toISOString().slice(0, 7));
  const categories = await api.getCategories();
  const categoryGroups = await api.getCategoryGroups();
  
  // Mapping categories to their groups
  const categoriesWithGroups = categories.map(category => {
    const group = categoryGroups.find(group => group.id === category.group_id) || {};
    return { ...category, groupName: group.name };
  });

  // Preparing data for the sheet
  const dataForSheet = categoriesWithGroups.map(category => [
    category.groupName,
    category.name,
    currentMonth.budgets[category.id]?.budgeted || 0,
    currentMonth.budgets[category.id]?.activity || 0,
    currentMonth.budgets[category.id]?.balance || 0,
  ]);

  return dataForSheet;
}

(async () => {
  await api.init({
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
  });

  await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, {password: process.env.ACTUAL_BUDGET_PASSWORD});

  let accounts = await api.getAccounts();
  const accountNamesAndBalances = accounts.filter(a => !a.closed).map(account => [
    account.name,
    account.balance / 10000 // Assuming the balance needs to be formatted this way
  ]);

  const categoriesData = await getCurrentMonthData();

  const auth = await authorize();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const accountsRange = process.env.ACCOUNTS_BALANCES_RANGE;
  const categoriesRange = process.env.CATEGORIES_DETAILS_RANGE;

  // Ensure or create the sheets based on the provided ranges
  const accountsSheetTitle = accountsRange.split('!')[0];
  const categoriesSheetTitle = categoriesRange.split('!')[0];
  await ensureSheetExists(auth, spreadsheetId, accountsSheetTitle);
  await ensureSheetExists(auth, spreadsheetId, categoriesSheetTitle);;

  // Update accounts and balances in the first sheet
  await updateSheet(auth, spreadsheetId, accountsRange, accountNamesAndBalances);

  // Update categories data in the second sheet
  await updateSheet(auth, spreadsheetId, categoriesRange, categoriesData);

})().then(() => { console.log("Done"); process.exit(); }).catch(console.error);
