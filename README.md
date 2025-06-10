# SIGAF (Should I Care)

A simple dashboard that tells you at a glance whether you should care about what Bitcoin is doing right now. No fancy charts, no complicated lines to figure out - just a clear signal about Bitcoin's current momentum.

## Overview

Let's be real: No chart is going to predict the future. Unless you're prepared to spend serious time understanding the macro landscape, everything else is just vibes.

This tool isn't for fortune telling. It's for one thing: showing you if Bitcoin's momentum is on track based on its own internal reality. The only inputs are price history and block time. That's it.

## What You'll See

The dashboard gives you a simple status:

- <span style="color: #059669; background: #d1fae5; padding: 2px 6px; border-radius: 4px;">PARTY</span>: Things are looking good, momentum is strong
- <span style="color: #d97706; background: #fef3c7; padding: 2px 6px; border-radius: 4px;">PEACHY</span>: Pretty decent momentum, worth keeping an eye on
- <span style="color: #6b7280; background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">MEH</span>: Business as usual, nothing to see here
- <span style="color: #2563eb; background: #dbeafe; padding: 2px 6px; border-radius: 4px;">WATCH</span>: Momentum's a bit weak, maybe pay attention
- <span style="color: #dc2626; background: #fef2f2; padding: 2px 6px; border-radius: 4px;">NO BUENO</span>: Things are looking rough, definitely worth watching

## Components

### Data
- Historical Bitcoin price data in `data/btc-price-history-data.csv`
- Gets updated automatically with the latest prices

### Lambda Function
- Located in `lambda/lambda_function.py`
- Keeps the price data fresh
- Just update the bucket name if you want to use it

### Dashboard
- Main interface in `index.html`
- Clean, simple display of the current status
- No charts to interpret, just a clear signal

## Setup

### Running the Dashboard
1. Open `index.html` in your browser
2. That's it! You'll see the current status right away

### Keeping Data Fresh
If you want to set up automatic updates:
1. Update the `BUCKET_NAME` in `lambda_function.py` to your S3 bucket
2. Deploy the Lambda function to AWS
3. Or just update the CSV file manually if you prefer

## Contributing

Feel free to:
- Update the data file with newer prices
- Make the dashboard look better
- Add new features (but keep it simple!)

## Contact

Find me on Nostr: [npub14c9x62qzjgfturmxp4lzwx52ph7nkzefjrkjr566wsnjmgkj2fpssfs5jx](https://primal.net/p/npub14c9x62qzjgfturmxp4lzwx52ph7nkzefjrkjr566wsnjmgkj2fpssfs5jx)

## License

I dgaf what you do with this code. Use it, modify it, sell it - whatever floats your boat. Just don't be a dick about it.
