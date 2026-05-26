<<<<<<< HEAD
# Inventory Scanner

Mobile-friendly barcode scanner with CSV export from MongoDB, ready for Vercel.

## Vercel setup

1. Deploy the repo to Vercel.
2. Add environment variables in Vercel:
	- `MONGO_URI`
	- `DB_NAME`
	- `COLLECTION_NAME`
	- `CSV_FIELDS`
3. Visit your deployed URL and tap **Export CSV**.

## Local setup (optional)

1. Copy `.env.example` to `.env` and fill in your MongoDB connection string.
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Open `http://localhost:3000` on your phone (same network) or desktop.

## CSV export

- Default export fields are controlled by `CSV_FIELDS`.
- You can override fields with `?fields=ProductKey,Name` on `/api/export`.
=======
# BarcodeScanner

>>>>>>> 09446b89d1fbeceeba1bd36eb58af001e68a6dbf
