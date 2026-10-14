import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

// --- In-memory booking store -------------------------------------------
// NOTE: on Vercel, serverless instances have ephemeral memory, so this store
// resets between cold starts / instances. Swap for a real database (Redis,
// Postgres, KV...) when you need durable bookings.
export interface Booking {
  id: string
  slot: string
  phone: string
  date: string // YYYY-MM-DD
  time: string // HH:MM (24h, local to the lot)
  duration: number // hours
  createdAt: string
}

const bookings: Booking[] = []

const SLOT_PATTERN = /^[A-C]\d{2}$/

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

// --- Home route - HTML --------------------------------------------------
app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Express on Vercel</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/book">Book Parking</a>
          <a href="/about">About</a>
          <a href="/api-data">API Data</a>
          <a href="/healthz">Health</a>
        </nav>
        <h1>Welcome to Express on Vercel 🚀</h1>
        <p>Pick your parking spot on the interactive lot map.</p>
        <p><a href="/book">🅿️ Book a parking slot</a></p>
        <img src="/logo.png" alt="Logo" width="120" />
      </body>
    </html>
  `)
})

app.get('/about', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'about.htm'))
})

// Parking booking page (graphical slot picker)
app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'components', 'book.htm'))
})

// --- Parking API --------------------------------------------------------

// Availability for a given date/time/duration: returns slots that are taken
app.get('/api/slots', (req, res) => {
  const date = String(req.query.date || '')
  const time = String(req.query.time || '')
  const duration = Number(req.query.duration || 0)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time) ||
      !Number.isFinite(duration) || duration <= 0 || duration > 24) {
    return res.status(400).json({ error: 'Invalid date, time or duration' })
  }

  const start = toMinutes(time)
  const end = start + duration * 60

  const booked = bookings
    .filter((b) => {
      if (b.date !== date) return false
      const bStart = toMinutes(b.time)
      const bEnd = bStart + b.duration * 60
      return overlaps(start, end, bStart, bEnd)
    })
    .map((b) => b.slot)

  res.json({ date, time, duration, booked: [...new Set(booked)] })
})

// Create a booking
app.post('/api/bookings', (req, res) => {
  const { slot, phone, date, time, duration } = req.body || {}

  if (typeof slot !== 'string' || !SLOT_PATTERN.test(slot)) {
    return res.status(400).json({ error: 'Invalid slot id (expected e.g. A03)' })
  }
  if (typeof phone !== 'string' || !/^[0-9+\-\s()]{7,20}$/.test(phone.trim())) {
    return res.status(400).json({ error: 'Invalid phone number' })
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date (expected YYYY-MM-DD)' })
  }
  if (typeof time !== 'string' || !/^\d{1,2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'Invalid time (expected HH:MM)' })
  }
  const dur = Number(duration)
  if (!Number.isFinite(dur) || dur <= 0 || dur > 24) {
    return res.status(400).json({ error: 'Duration must be between 1 and 24 hours' })
  }

  const start = toMinutes(time)
  const end = start + dur * 60

  // Slot conflict check for the same day
  const conflict = bookings.find((b) => {
    if (b.slot !== slot || b.date !== date) return false
    const bStart = toMinutes(b.time)
    const bEnd = bStart + b.duration * 60
    return overlaps(start, end, bStart, bEnd)
  })
  if (conflict) {
    return res.status(409).json({
      error: `Slot ${slot} is already booked for that time`,
      conflict: { date: conflict.date, time: conflict.time, duration: conflict.duration },
    })
  }

  const booking: Booking = {
    id: `bk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    slot,
    phone: phone.trim(),
    date,
    time,
    duration: dur,
    createdAt: new Date().toISOString(),
  }
  bookings.push(booking)

  res.status(201).json({ message: 'Booking confirmed', booking })
})

// List all bookings (handy for testing / admin views)
app.get('/api/bookings', (req, res) => {
  res.json({ count: bookings.length, bookings })
})

// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry'],
  })
})

// Health check
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

export default app

// Local dev helper: on Vercel the platform imports `app` directly,
// so only listen when running the file locally.
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 3000)
  app.listen(port, () => console.log(`Listening on http://localhost:${port}`))
}
