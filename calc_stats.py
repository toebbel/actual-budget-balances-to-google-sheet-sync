import datetime
import pandas as pd
import numpy as np

def months_between(d1, d2):
    return d1.month - d2.month + 12*(d1.year - d2.year)

def linear_decay_weights(n_months, decline_start=13, min_weight=0.01):
    weights = np.ones(n_months)
    if n_months > decline_start:
        decline_months = n_months - decline_start
        decay_values = np.linspace(1, min_weight, decline_months)
        weights[decline_start:] = decay_values
    
    return weights

# Calculate the weight based on linear decay
def linear_decay_weight(date, weights, current_date=datetime.datetime.now()):
  age_in_months = months_between(current_date, date)
  return weights[age_in_months]

# Weight function 1: Exponential decay
def exponential_decay_weight(date, current_date=datetime.datetime.now()):
  age_in_months = months_between(current_date, date)
  weight = np.exp(-age_in_months / 13)
  return weight

# Weight function 2: Quadratic decay
def quadratic_decay_weight(date, current_date=datetime.datetime.now()):
  age_in_months = months_between(current_date, date)
  weight = max(1 - (age_in_months / 13) ** 2, 0)
  return weight

# Group transactions by month and sum up their amount
df = pd.read_csv('transactions.csv')
df = df[df['category active'] == "true"].copy()
df['month'] = pd.to_datetime(df['transaction date']).dt.to_period('M').dt.to_timestamp('M')
df['month'] = df['month'] - pd.offsets.MonthBegin(1)
df_grouped = df.groupby(['month', 'category'])[['amount']].sum().reset_index()

def resolve_category_group(category):
   result = df[df['category'] == category]['category group'].values[0]
   print(result)
   return result

# Sort the dataframe by month in ascending order
df_sorted = df_grouped.sort_values('month')

current_date = datetime.datetime.now()
weights = linear_decay_weights(months_between(current_date, pd.to_datetime(df['transaction date']).min()) + 1)
df_sorted['linear_decay_weigths'] = df_sorted.apply(lambda row: linear_decay_weight(row['month'], weights, current_date=current_date), axis=1)
category_stats = [["category", "group", "average", "linear_decay"]]
sorted_categories = sorted(df_sorted['category'].unique())
for category in sorted_categories:
  category_data = df_sorted[df_sorted['category'] == category]
  category_age = months_between(current_date, pd.to_datetime(category_data['month']).min())
  if category_data['linear_decay_weigths'].sum() == 0:
    linear_decay = np.float32(0)
  else:
    linear_decay = (category_data['amount'] * category_data['linear_decay_weigths']).sum() / category_data['linear_decay_weigths'].sum()
  average = category_data['amount'].sum() / category_age
  category_stats.append([category, resolve_category_group(category), average.item(), linear_decay.item()])

import gspread
from oauth2client.service_account import ServiceAccountCredentials

# Set up credentials
scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
credentials = ServiceAccountCredentials.from_json_keyfile_name('credentials.json', scope)
client = gspread.authorize(credentials)

sheet = client.open('Finanzplanung / Bospar')
worksheet = sheet.worksheet("Category Stats")
worksheet.update(category_stats)
print("Statistics posted to Google Sheets successfully!")