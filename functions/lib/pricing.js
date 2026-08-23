/**
 * All pricing and availability decisions are made here, on the
 * server, against the server clock.
 *
 * This is the whole reason the scarcity on the page is honest: a
 * stale browser tab, a wrong device clock, or someone editing the
 * DOM cannot buy at the founding rate after it expires or claim a
 * seat past the cap. The page displays what this function decides,
 * and the checkout charges what this function returns.
 */

const toMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

export function resolvePricing(cls, now = Date.now()) {
  const price = cls.price || {};
  const full = Number(price.amount) || 0;
  const founding = Number(price.foundingAmount) || 0;
  const foundingUntil = toMillis(price.foundingUntil);

  const foundingActive = founding > 0 && founding < full && (!foundingUntil || now < foundingUntil);

  return {
    currency: (price.currency || 'usd').toLowerCase(),
    fullAmount: full,
    amount: foundingActive ? founding : full,
    foundingActive,
    foundingUntil,
    foundingEndsIn: foundingUntil ? Math.max(0, foundingUntil - now) : null
  };
}

export function resolveAvailability(cls, now = Date.now()) {
  const capacity = Number(cls.capacity) || 0;
  const seatsPaid = Number(cls.seatsPaid) || 0;
  const seatsLeft = capacity > 0 ? Math.max(0, capacity - seatsPaid) : null;
  const closeAt = toMillis(cls.enrollCloseAt);

  return {
    capacity,
    seatsPaid,
    seatsLeft,
    soldOut: capacity > 0 && seatsPaid >= capacity,
    enrollClosed: closeAt !== null && now >= closeAt,
    enrollCloseAt: closeAt
  };
}

/**
 * A class only accepts money when Anthony has scheduled it, seats
 * remain, and the enrollment window is open. Returns a reason
 * string when checkout should be refused so the page can explain
 * itself rather than silently failing.
 */
export function checkoutBlockedReason(cls, now = Date.now()) {
  if (cls.status !== 'scheduled') {
    return 'Enrollment for this class is not open yet. You will get an email the moment it is.';
  }
  const avail = resolveAvailability(cls, now);
  if (avail.enrollClosed) return 'Enrollment for this cohort has closed.';
  if (avail.soldOut) return 'This cohort is full. Join the waitlist and you will be first in line for the next one.';
  return null;
}

export const formatMoney = (cents, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: 0 })
    .format((Number(cents) || 0) / 100);
