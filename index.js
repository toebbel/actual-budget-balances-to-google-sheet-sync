require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { google } = require('googleapis');
const api = require('@actual-app/api');

async function authorize() {
  try {
    return new google.auth.GoogleAuth({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, 
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } catch (error) {
    console.error('Error authorizing Google API:', error);
    process.exit(1);
  }
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
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
  } catch (error) {
    console.error(`Error updating sheet with range ${range}:`, error);
  }
}

async function getMonthData(date) {
  try {
    const month = await api.getBudgetMonth(date);
    const categories = await api.getCategories();
    const categoryGroups = await api.getCategoryGroups();

    const categoriesWithGroups = categories.map(category => {
      const group = categoryGroups.find(group => group.id === category.group_id) || {};
      return { ...category, groupName: group.name };
    });

    const dataForSheet = categoriesWithGroups.map(category => [
      category.groupName,
      category.name,
      month.budgets[category.id]?.budgeted || 0,
      month.budgets[category.id]?.activity || 0,
      month.budgets[category.id]?.balance || 0,
    ]);

    return dataForSheet;
  } catch (error) {
    console.error('Error fetching month data:', error);
    return [];
  }
}

(async () => {
  try {
    await api.init({
      serverURL: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_SERVER_PASSWORD,
    });

    await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, { password: process.env.ACTUAL_BUDGET_PASSWORD });

    const accounts = await api.getAccounts();
    const accountNamesAndBalances = accounts.filter(a => !a.closed).map(account => [
      account.name,
      account.balance / 10000 
    ]);

    const currentDate = new Date();
    const priorMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1).toISOString().slice(0, 7);
    const currentMonth = currentDate.toISOString().slice(0, 7);

    const priorMonthData = await getMonthData(priorMonth);
    const currentMonthData = await getMonthData(currentMonth);

    const auth = await authorize();
    const spreadsheetId = process.env.SPREADSHEET_ID;

    const accountsRange = process.env.ACCOUNTS_BALANCES_RANGE || 'Sheet1!A1:B';
    const priorMonthRange = process.env.PRIOR_MONTH_RANGE || 'Sheet2!A1:E';
    const currentMonthRange = process.env.CURRENT_MONTH_RANGE || 'Sheet3!A1:E';

    const accountsSheetTitle = accountsRange.split('!')[0];
    const priorMonthSheetTitle = priorMonthRange.split('!')[0];
    const currentMonthSheetTitle = currentMonthRange.split('!')[0];

    await ensureSheetExists(auth, spreadsheetId, accountsSheetTitle);
    await ensureSheetExists(auth, spreadsheetId, priorMonthSheetTitle);
    await ensureSheetExists(auth, spreadsheetId, currentMonthSheetTitle);

    await updateSheet(auth, spreadsheetId, accountsRange, accountNamesAndBalances);
    await updateSheet(auth, spreadsheetId, priorMonthRange, priorMonthData);
    await updateSheet(auth, spreadsheetId, currentMonthRange, currentMonthData);

    console.log("Data sync completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error('Error in the main process:', error);
    process.exit(1);
  }
})();
