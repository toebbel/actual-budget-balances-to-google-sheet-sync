require('dotenv').config();

const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const { google } = require('googleapis');
const api = require('@actual-app/api');

// Validate environment variables
const requiredEnvVars = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ACTUAL_SERVER_URL',
  'ACTUAL_SERVER_PASSWORD',
  'SPREADSHEET_ID',
  'ACCOUNTS_BALANCES_RANGE',
  'PRIOR_MONTH_RANGE',
  'CURRENT_MONTH_RANGE',
  'ACTUAL_BUDGET_ID',
];
requiredEnvVars.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`Error: Environment variable ${varName} is not defined.`);
    process.exit(1);
  }
});

async function authorize() {
  try {
    console.log('Authorizing Google API...');
    return new google.auth.GoogleAuth({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } catch (error) {
    console.error('Error authorizing Google API:', error.message);
    process.exit(1);
  }
}

async function ensureSheetExists(auth, spreadsheetId, title) {
  try {
    console.log(`Checking if sheet "${title}" exists...`);
    const sheets = google.sheets({ version: 'v4', auth });
    const { data } = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = data.sheets.some(sheet => sheet.properties.title === title);

    if (!exists) {
      console.log(`Sheet "${title}" not found, creating...`);
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
    } else {
      console.log(`Sheet "${title}" already exists.`);
    }
  } catch (error) {
    console.error(`Error ensuring sheet "${title}" exists: ${error.message}`);
    process.exit(1);
  }
}

async function updateSheet(auth, spreadsheetId, range, values) {
  try {
    console.log(`Updating sheet with range "${range}"...`);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values }
    });
    console.log(`Sheet "${range}" updated successfully.`);
  } catch (error) {
    console.error(`Error updating sheet with range "${range}": ${error.message}`);
  }
}

async function getMonthData(date) {
  try {
    console.log(`Fetching data for month: ${date}...`);
    const month = await api.getMonth(date);
    const categories = await api.getCategories();
    const categoryGroups = await api.getCategoryGroups();

    const categoriesWithGroups = categories.map(category => {
      const group = categoryGroups.find(group => group.id === category.group_id) || {};
      return { ...category, groupName: group.name };
    });

    const dataForSheet = categoriesWithGroups.map(category => [
      category.groupName,
      category.name,
      month.s[category.id]?.ed || 0,
      month.s[category.id]?.activity || 0,
      month.s[category.id]?.balance || 0,
    ]);

    return dataForSheet;
  } catch (error) {
    console.error('Error fetching month data:', error.message);
    return [];
  }
}

(async () => {
  try {
    console.log('Initializing Actual API...');
    await api.init({
      serverURL: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_SERVER_PASSWORD,
    });

    console.log('Downloading budget data...');
    try {
        const budgetDownload = await api.downloadBudget(process.env.ACTUAL_BUDGET_ID, { password: process.env.ACTUAL_SERVER_PASSWORD });
        console.log('Budget download result:', budgetDownload);

        if (!budgetDownload || typeof budgetDownload !== 'object') {
          throw new Error('Failed to download budget data or invalid data received.');
        }
    } catch (error) {
        console.error('Error downloading budget data:', error.message);
        throw error;
    }
    
    // Add a log to check what is returned
    console.log('Budget download result:', budgetDownload);

    console.log('Fetching account balances...');
    const accounts = await api.getAccounts();
    if (!accounts || !Array.isArray(accounts)) {
      throw new Error('Failed to retrieve accounts.');
    }

    const accountNamesAndBalances = await Promise.all(accounts.filter(a => !a.closed).map(async account => {
      console.log(`Processing account: ${account.name}`);
      const transactions = await api.getTransactions(account.id);
      
      if (!transactions || !Array.isArray(transactions)) {
        console.error(`No transactions found for account ${account.name}, skipping.`);
        return null; // Skip this account
      }

      const balance = transactions.map(t => t.amount).reduce((a, b) => a + b, 0);
      return [account.name, balance / 100]; // Assuming balance is in cents
    }));
    
    const filteredAccountNamesAndBalances = accountNamesAndBalances.filter(Boolean).sort((a, b) => {
      const nameA = a[0].replace("[", "");
      const nameB = b[0].replace("[", "");
      return nameA.localeCompare(nameB);
    });

    console.log('Account Names and Balances:', filteredAccountNamesAndBalances);

    const currentDate = new Date();

    const priorMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const currentMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1)).toISOString().slice(0, 7);

    const priorMonthData = await getMonthData(priorMonth);
    if (!priorMonthData || !Array.isArray(priorMonthData)) {
      throw new Error('Failed to retrieve valid prior month data');
    }

    const currentMonthData = await getMonthData(currentMonth);
    if (!currentMonthData || !Array.isArray(currentMonthData)) {
      throw new Error('Failed to retrieve valid current month data');
    }

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

    await updateSheet(auth, spreadsheetId, accountsRange, filteredAccountNamesAndBalances);
    await updateSheet(auth, spreadsheetId, priorMonthRange, priorMonthData);
    await updateSheet(auth, spreadsheetId, currentMonthRange, currentMonthData);

    console.log("Data sync completed successfully.");
  } catch (error) {
    console.error('Error in the main process:', error.message);

    if (error.message.includes('timestamp')) {
      console.error('It appears the data is missing a timestamp. This may indicate incomplete or corrupted data.');
    }

    // Optionally, provide fallback logic or more error handling here.

  } finally {
    console.log('Shutting down Actual API...');
    try {
      await api.shutdown(); // Ensure proper shutdown
    } catch (shutdownError) {
      console.error('Error shutting down Actual API:', shutdownError.message);
    }
    process.exit(0);
  }
})();
