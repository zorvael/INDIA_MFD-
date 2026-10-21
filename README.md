# India MFD dashboard

A private, single-workspace MVP for maintaining investor and SIP records. Records are entered manually and stored in a local SQLite database. The importer supports the dashboard CSV format and the UTI active SIP report format. It deliberately ignores PAN and folio identifiers in the UTI file. There is no AMC/RTA connection and the app does not fetch NAV, holdings, transactions, or SIP status automatically. The interface labels the data as manual/imported so it is not mistaken for a live financial feed.

## Requirements

- Node.js 20 or later
- A private server or trusted hosting environment with persistent disk storage
- HTTPS in production

## Run locally

```sh
npm install
npm run create-admin
npm start
```

The setup command asks for a username and password interactively. Use a unique password of at least 14 characters and store it in a password manager. It is not written to the repository.

Open `http://localhost:3000`. The default database is `mfd.sqlite` in the application directory. Set `DB_PATH` to a persistent private location if needed.

## Production settings

Set these in the hosting provider's secret/configuration panel, never in source code:

- `NODE_ENV=production`
- `SESSION_SECRET`: a long random secret (at least 32 random bytes)
- `DB_PATH`: persistent private database path
- `PORT`: supplied by host if required
- `MFD_ARN`, `MFD_NAME`, `MFD_MOBILE`, `MFD_EMAIL`: optional practice profile values shown only after login. Set these in the hosting provider secret/configuration panel; do not put actual values in source files.

Deploy behind HTTPS. The app enables secure cookies in production. Back up the database using an encrypted, access-controlled process. Do not deploy this sample configuration to a public server before setting production secrets and HTTPS.

## Included

- Hashed password login, login rate limiting, server-side SQLite sessions, HttpOnly/SameSite cookies, session rotation, CSRF checks and security headers
- Investor records and investor-wise SIP entries
- Active, stopped and registered status labels, monthly amounts and recorded due days
- CSV import in the dashboard or UTI active SIP report format, with validation and duplicate SIP skipping. The UTI Start Date day is used as the due day and should be verified.
- CSV export with spreadsheet formula neutralization
- Daily due-day view based on the records in the database

## Not included

- Live NAV, current valuation, units/holdings, transactions, automated SIP registration or stop checks
- Automated daily updates or messages to clients
- Multi-user/role management

These need an authorized and documented data provider/API, proper permissions, and a defined import format. Do not use investor login credentials, scrape AMC/RTA portals, or store personal banking credentials in this app. Once an authorized source is chosen, build its integration as a separate server-side connector and show the source and timestamp for each update.

## Data handling

This app stores investor names and optional contact fields along with scheme names, SIP amounts, statuses and due days. Restrict database, server, backup and hosting access to authorized staff. Collect only information needed for the workflow. The notes field should not contain PAN, bank details, passwords, or other sensitive identifiers. CSV exports contain client data; keep them private and delete them when no longer needed.
