import boto3
import csv
import io
import json
import urllib.request
from datetime import datetime, timedelta, timezone

BUCKET_NAME = 'bfg-btc-price-history'
KEY = 'data/btc-price-history-data.csv'

"""
This lambda updates the BTC price history CSV in S3 by fetching the latest data from CoinGecko.
It only fetches data if there are missing dates, and provides clear status messages.
Data is stored with dates in YYYY-MM-DD format instead of timestamps.
"""

def lambda_handler(event, context):
    s3 = boto3.client('s3')

    # Download existing CSV from S3
    obj = s3.get_object(Bucket=BUCKET_NAME, Key=KEY)
    body = obj['Body'].read().decode('utf-8').strip().splitlines()
    rows = list(csv.reader(body))
    header = rows[0]

    # Index existing rows by date string (YYYY-MM-DD format)
    data_by_date = {}
    for row in rows[1:]:
        try:
            # Assuming first column is date string in YYYY-MM-DD format
            date_str = row[0]
            # Validate date format
            datetime.strptime(date_str, '%Y-%m-%d')
            data_by_date[date_str] = row
        except Exception:
            continue

    # Compute yesterday date (UTC) - we never process "today" as API data is incomplete
    now_utc = datetime.now(timezone.utc)
    today_dt = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_dt = today_dt - timedelta(days=1)
    yesterday_date_str = yesterday_dt.strftime('%Y-%m-%d')
    
    print(f"Today (UTC): {today_dt.strftime('%Y-%m-%d')}")
    print(f"Checking for data up to yesterday (UTC): {yesterday_date_str}")

    # Check if yesterday's data already exists
    if yesterday_date_str in data_by_date:
        print(f"Yesterday's data ({yesterday_date_str}) already exists")
        
        # Check for any gaps in the last 7 days
        check_start_dt = yesterday_dt - timedelta(days=6)
        missing_dates = []
        for i in range(7):
            check_date = check_start_dt + timedelta(days=i)
            check_date_str = check_date.strftime('%Y-%m-%d')
            if check_date_str not in data_by_date:
                missing_dates.append(check_date_str)
        
        if not missing_dates:
            return {
                'status': 'no_update_needed',
                'message': 'All data up to yesterday is already present',
                'latest_date': yesterday_date_str,
                'total_rows': len(data_by_date),
                's3_key': KEY
            }
        else:
            print(f"Found {len(missing_dates)} missing dates in last 7 days: {missing_dates}")
            # Continue to fetch data to fill gaps
    else:
        print(f"Yesterday's data ({yesterday_date_str}) is missing")

    # Determine what dates we need to fetch
    check_start_dt = yesterday_dt - timedelta(days=6)
    missing_dates = []
    for i in range(7):
        check_date = check_start_dt + timedelta(days=i)
        check_date_str = check_date.strftime('%Y-%m-%d')
        if check_date_str not in data_by_date:
            missing_dates.append(check_date_str)

    # If we have gaps, extend the window to 27 days to be thorough
    if len(missing_dates) > 1:
        print(f"Multiple gaps detected, extending fetch window to 27 days")
        days_to_fetch = 27
        fetch_start_dt = yesterday_dt - timedelta(days=26)
        
        # Recalculate missing dates for extended window
        missing_dates = []
        for i in range(27):
            check_date = fetch_start_dt + timedelta(days=i)
            check_date_str = check_date.strftime('%Y-%m-%d')
            if check_date_str not in data_by_date:
                missing_dates.append(check_date_str)
    else:
        days_to_fetch = 7
        fetch_start_dt = check_start_dt

    print(f"Need to fetch {len(missing_dates)} missing dates: {missing_dates}")

    # Fetch data from CoinGecko
    url = (
        f'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart'
        f'?vs_currency=usd&days={days_to_fetch+1}&interval=daily'
    )
    
    print(f"Fetching data from CoinGecko for {days_to_fetch} days")
    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode('utf-8'))

    # Build maps: date_string -> value (only for missing dates)
    price_map = {}
    volume_map = {}
    market_cap_map = {}

    for ts, price in data.get('prices', []):
        dt = datetime.fromtimestamp(ts // 1000, timezone.utc)
        date_str = dt.strftime('%Y-%m-%d')
        # Only process data up to yesterday and only for missing dates
        if dt.date() <= yesterday_dt.date() and date_str in missing_dates:
            price_map[date_str] = price

    for ts, volume in data.get('total_volumes', []):
        dt = datetime.fromtimestamp(ts // 1000, timezone.utc)
        date_str = dt.strftime('%Y-%m-%d')
        # Only process data up to yesterday and only for missing dates
        if dt.date() <= yesterday_dt.date() and date_str in missing_dates:
            volume_map[date_str] = volume

    for ts, market_cap in data.get('market_caps', []):
        dt = datetime.fromtimestamp(ts // 1000, timezone.utc)
        date_str = dt.strftime('%Y-%m-%d')
        # Only process data up to yesterday and only for missing dates
        if dt.date() <= yesterday_dt.date() and date_str in missing_dates:
            market_cap_map[date_str] = market_cap

    # Add only the missing dates that we have complete data for
    added_dates = []
    for date_str in missing_dates:
        if (date_str in price_map and 
            date_str in volume_map and 
            date_str in market_cap_map):
            
            price = price_map[date_str]
            volume = volume_map[date_str]
            market_cap = market_cap_map[date_str]
            
            data_by_date[date_str] = [
                date_str,
                str(price),
                str(volume),
                str(market_cap),
            ]
            added_dates.append(date_str)
            print(f"Added data for {date_str}")

    # Only upload if we actually added new data
    if not added_dates:
        return {
            'status': 'no_new_data',
            'message': 'API did not return data for missing dates',
            'missing_dates': missing_dates,
            'total_rows': len(data_by_date),
            's3_key': KEY
        }

    # Rebuild all rows, sorted descending by date
    all_rows = list(data_by_date.values())
    all_rows_sorted = sorted(all_rows, key=lambda r: r[0], reverse=True)

    # Write back to CSV in-memory
    output = io.StringIO()
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(header)
    writer.writerows(all_rows_sorted)
    csv_bytes = output.getvalue().encode('utf-8')

    # Upload updated CSV to S3
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=KEY,
        Body=csv_bytes,
        ContentType='text/csv'
    )

    return {
        'status': 'updated',
        'message': f'Successfully added {len(added_dates)} new dates',
        'added_dates': sorted(added_dates),
        'fetch_window_days': days_to_fetch,
        'total_rows': len(all_rows_sorted),
        's3_key': KEY
    }