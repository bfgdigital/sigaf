import boto3
import csv
import io
import json
import urllib.request
from datetime import datetime, timedelta, timezone

BUCKET_NAME = 'bfg-btc-price-history'
KEY = 'btc-price-history-data.csv'

"""
This is a pretty basic lambda that updates the CSV in S3 with the latest data from CoinGecko.
It also checks for gaps in the last 7 days and extends the fetch window to 27 days if there are gaps.
It then writes the data back to S3.

You might need to prep or update the csv before running this, but this will then keep it up to date.
"""

def lambda_handler(event, context):
    s3 = boto3.client('s3')

    # Download the CSV from S3
    obj = s3.get_object(Bucket=BUCKET_NAME, Key=KEY)
    body = obj['Body'].read().decode('utf-8').strip().splitlines()
    rows = list(csv.reader(body))
    header = rows[0]

    # Index all rows by day (UTC midnight)
    data_by_day = {}
    for row in rows[1:]:
        try:
            ts = int(row[0])
            dt = datetime.fromtimestamp(ts // 1000, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            data_by_day[dt] = row
        except Exception:
            continue

    # Check last 7 days for gaps, using yesterday as reference
    yesterday = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
    check_start = yesterday - timedelta(days=6)  # Check last 7 days
    
    # Check for gaps in the last 7 days
    has_gaps = False
    for i in range(7):
        check_date = check_start + timedelta(days=i)
        if check_date > yesterday:
            break
        if check_date not in data_by_day:
            has_gaps = True
            break

    # Determine how many days to fetch
    days_to_patch = 7
    if has_gaps:
        days_to_patch = 27  # 7 days + 20 extra days to fill gaps
        print(f"Found gaps in last 7 days, extending fetch window to {days_to_patch} days")
    
    patch_start = yesterday - timedelta(days=days_to_patch - 1)

    url = f'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days={days_to_patch+1}&interval=daily'
    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode('utf-8'))

    # Build dicts: dt -> price/volume/market_cap
    price_map = {}
    volume_map = {}
    market_cap_map = {}
    
    for ts, price in data.get('prices', []):
        dt = datetime.fromtimestamp(ts // 1000, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        if dt <= yesterday:  # Only use data up to yesterday
            price_map[dt] = price
        
    for ts, volume in data.get('total_volumes', []):
        dt = datetime.fromtimestamp(ts // 1000, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        if dt <= yesterday:  # Only use data up to yesterday
            volume_map[dt] = volume
        
    for ts, market_cap in data.get('market_caps', []):
        dt = datetime.fromtimestamp(ts // 1000, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        if dt <= yesterday:  # Only use data up to yesterday
            market_cap_map[dt] = market_cap

    # Patch these days in memory
    patched_days = 0
    for i in range(days_to_patch):
        dt = patch_start + timedelta(days=i)
        if dt > yesterday:  # Stop at yesterday
            break
        price = price_map.get(dt)
        volume = volume_map.get(dt)
        market_cap = market_cap_map.get(dt)
        if price is not None and volume is not None and market_cap is not None:
            unix_ts = int(dt.timestamp()) * 1000
            # Store raw values without formatting to preserve precision
            data_by_day[dt] = [str(unix_ts), str(price), str(volume), str(market_cap)]
            patched_days += 1

    # Rebuild all rows (sorted by timestamp descending)
    all_rows = list(data_by_day.values())
    all_rows_sorted = sorted(all_rows, key=lambda r: int(r[0]), reverse=True)  # Changed to reverse=True for descending order

    # Write back to CSV in-memory
    output = io.StringIO()
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(header)
    writer.writerows(all_rows_sorted)
    output.seek(0)
    csv_bytes = output.read().encode('utf-8')

    # Upload to S3
    s3.put_object(Bucket=BUCKET_NAME, Key=KEY, Body=csv_bytes, ContentType='text/csv')

    return {
        'status': 'patched',
        'days_patched': patched_days,
        'patch_window_start': patch_start.strftime('%Y-%m-%d'),
        'patch_window_end': yesterday.strftime('%Y-%m-%d'),
        'total_rows': len(all_rows_sorted),
        's3_key': KEY,
        'extended_fetch': has_gaps
    }
