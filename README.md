# Coupon Management
Assignment Name: Coupon Management

## Project Overview
A simple in-memory Coupon Management HTTP service implementing:
- `POST /coupons` to create coupons with eligibility rules.
- `POST /best-coupon` to evaluate and return the best coupon for a given user + cart.
- `GET /coupons` to list coupons for debugging.
- `POST /use-coupon` to record coupon usage per user (usage limit enforcement).

This project is intentionally minimal and focused on eligibility & selection logic.

## Tech stack
- Node.js (>=18)
- Express.js
- No database — in-memory JSON arrays (easy for assignment/testing)

## How to run
### Prerequisites
- Node.js (v18+) and npm

### Setup
1. `git clone <repo>`
2. `cd coupon-management-assignment`
3. `npm install`

### Start the server
- `npm start`
- The service runs on `http://localhost:3000` by default.

Sample seeded coupons are created on startup. A demo user is seeded for the assignment login:
- Email: `hire-me@anshumat.org`
- Password: `HireMe@2025!`

## Endpoints
- `GET /` — health/info
- `POST /coupons` — create coupon
  - Body: coupon JSON (see sample below)
  - Duplicate `code` => **409 Conflict** (duplicates rejected)
- `GET /coupons` — list coupons
- `POST /best-coupon` — find best coupon
  - Body: `{ userContext: {...}, cart: {...}, userId: 'u123' }`
  - Returns `{ best: null }` or `{ best: { code, description, discountAmount, coupon } }`
- `POST /use-coupon` — mark coupon as used by user (body: `{ userId, couponCode }`)

## Coupon JSON schema (required fields)
```json
{
  "code": "WELCOME100",
  "description": "₹100 off for new users",
  "discountType": "FLAT", // or "PERCENT"
  "discountValue": 100,
  "maxDiscountAmount": 200, // optional, relevant for PERCENT
  "startDate": "2025-12-01T00:00:00.000Z",
  "endDate": "2026-01-01T00:00:00.000Z",
  "usageLimitPerUser": 1, // optional
  "eligibility": { /* optional object described below */ }
}
