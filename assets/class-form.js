import { callFn, readableError } from './firebase-init.js';

/**
 * Renders and runs a class signup form from a formFields schema.
 *
 * The schema is stored on the class document and edited in the
 * admin console, which is what makes "a signup form for any class
 * I want to run" possible without a code change per class. This
 * module is the only place that knows how to turn that schema into
 * the site's markup.
 */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ── Attribution ───────────────────────────────────────────
   Captured silently. Anthony is teaching people to grow on social
   media; being able to show which post produced which signup is
   both useful to him and a live demonstration of the material. */
function captureAttribution() {
  const params = new URLSearchParams(location.search);
  const utm = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = params.get(key);
    if (v) utm[key] = v.slice(0, 120);
  }
  return { ...utm, referrer: document.referrer.slice(0, 300), landingPath: location.pathname + location.search };
}

/* ── Field rendering ───────────────────────────────────────── */
function renderField(field) {
  const id = `f-${slugify(field.id)}`;
  const required = field.required
    ? '<span class="field-required">*</span>'
    : '<span class="field-optional">optional</span>';
  const help = field.help ? `<div class="field-help">${esc(field.help)}</div>` : '';

  if (field.type === 'radio' || field.type === 'checkbox') {
    const inputType = field.type;
    const chips = (field.options || [])
      .map((opt, i) => {
        const optId = `${id}-${i}`;
        return `<div class="radio-chip">
  <input type="${inputType}" name="${esc(field.id)}" id="${optId}" value="${esc(opt)}">
  <label for="${optId}">${esc(opt)}</label>
</div>`;
      })
      .join('');
    return `<div class="field" id="${id}" data-field="${esc(field.id)}" data-type="${inputType}">
  <div class="radio-group-label">${esc(field.label)} ${required}</div>
  ${help}
  <div class="radio-chips">${chips}</div>
  <div class="field-error">Please choose an option.</div>
</div>`;
  }

  if (field.type === 'select') {
    const opts = (field.options || []).map((o) => `<option>${esc(o)}</option>`).join('');
    return `<div class="field" id="${id}" data-field="${esc(field.id)}" data-type="select">
  <label class="field-label" for="${id}-input">${esc(field.label)} ${required}</label>
  ${help}
  <select class="field-select" id="${id}-input" name="${esc(field.id)}">
    <option value="" disabled selected>Select an option</option>${opts}
  </select>
  <div class="field-error">Please choose an option.</div>
</div>`;
  }

  if (field.type === 'textarea') {
    return `<div class="field" id="${id}" data-field="${esc(field.id)}" data-type="textarea">
  <label class="field-label" for="${id}-input">${esc(field.label)} ${required}</label>
  ${help}
  <textarea class="field-textarea" id="${id}-input" name="${esc(field.id)}" placeholder="${esc(field.placeholder || '')}"></textarea>
  <div class="field-error">This field is required.</div>
</div>`;
  }

  return `<div class="field" id="${id}" data-field="${esc(field.id)}" data-type="text">
  <label class="field-label" for="${id}-input">${esc(field.label)} ${required}</label>
  ${help}
  <input class="field-input" type="${field.type === 'tel' ? 'tel' : 'text'}" id="${id}-input"
         name="${esc(field.id)}" placeholder="${esc(field.placeholder || '')}">
  <div class="field-error">This field is required.</div>
</div>`;
}

/* ── Reading values back out ───────────────────────────────── */
function readField(form, field) {
  if (field.type === 'checkbox') {
    return [...form.querySelectorAll(`input[name="${CSS.escape(field.id)}"]:checked`)].map((i) => i.value);
  }
  if (field.type === 'radio') {
    return form.querySelector(`input[name="${CSS.escape(field.id)}"]:checked`)?.value || '';
  }
  return form.querySelector(`[name="${CSS.escape(field.id)}"]`)?.value?.trim() || '';
}

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : !v);

/* ── Mount ─────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {string} opts.slug        class slug in Firestore
 * @param {HTMLElement} opts.mount  container for the generated fields
 * @param {HTMLFormElement} opts.form
 * @param {Array}  opts.formFields  schema, from the class doc
 * @param {Function} [opts.onSuccess]
 */
export function mountClassForm({ slug, mount, form, formFields = [], onSuccess }) {
  const renderedAt = Date.now();

  mount.innerHTML = formFields.map(renderField).join('\n');

  // Honeypot. Off-screen rather than hidden, because a fair number
  // of bots skip display:none inputs but happily fill this one.
  const hp = document.createElement('div');
  hp.className = 'hp-field';
  hp.setAttribute('aria-hidden', 'true');
  hp.innerHTML =
    '<label for="company-website">Company website</label>' +
    '<input type="text" id="company-website" name="company_website" tabindex="-1" autocomplete="off">';
  form.appendChild(hp);

  const alert = form.querySelector('[data-form-alert]');
  const button = form.querySelector('[data-submit]');
  const buttonLabel = button?.querySelector('[data-submit-label]');
  const originalLabel = buttonLabel?.textContent || 'Reserve My Seat';

  const showAlert = (msg) => {
    if (!alert) return;
    alert.textContent = msg;
    alert.classList.add('show');
    alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const clearAlert = () => alert?.classList.remove('show');

  // Clear a field's error the moment the person fixes it, rather
  // than making them submit again to find out.
  form.addEventListener('input', (e) => {
    e.target.closest('.field')?.classList.remove('invalid');
    clearAlert();
  });
  form.addEventListener('change', (e) => {
    e.target.closest('.field')?.classList.remove('invalid');
    clearAlert();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const firstName = form.querySelector('[name="firstName"]')?.value.trim() || '';
    const lastName = form.querySelector('[name="lastName"]')?.value.trim() || '';
    const email = form.querySelector('[name="email"]')?.value.trim() || '';
    const phone = form.querySelector('[name="phone"]')?.value.trim() || '';

    let firstInvalid = null;
    const markInvalid = (el) => {
      const wrap = el?.closest('.field');
      if (!wrap) return;
      wrap.classList.add('invalid');
      firstInvalid = firstInvalid || wrap;
    };

    if (!firstName) markInvalid(form.querySelector('[name="firstName"]'));
    // Last name and phone are required now: both are part of the
    // member portal account created from this submission.
    if (!lastName) markInvalid(form.querySelector('[name="lastName"]'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) markInvalid(form.querySelector('[name="email"]'));
    if (phone.replace(/\D/g, '').length < 10) markInvalid(form.querySelector('[name="phone"]'));

    const answers = {};
    for (const field of formFields) {
      const value = readField(form, field);
      if (field.required && isEmpty(value)) {
        markInvalid(form.querySelector(`[data-field="${CSS.escape(field.id)}"]`));
        continue;
      }
      if (!isEmpty(value)) answers[field.id] = value;
    }

    if (firstInvalid) {
      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (button) button.disabled = true;
    if (buttonLabel) buttonLabel.textContent = 'Saving your spot...';

    try {
      const result = await callFn('submitSignup', {
        slug,
        firstName,
        lastName,
        email,
        phone,
        answers,
        hp: form.querySelector('[name="company_website"]')?.value || '',
        renderedAt,
        source: 'website',
        attribution: captureAttribution(),
        consent: {
          sms: form.querySelector('[data-consent="sms"]')?.classList.contains('checked') || false,
          marketing: form.querySelector('[data-consent="marketing"]')?.classList.contains('checked') || false
        }
      });
      onSuccess?.(result, { firstName, email });
    } catch (err) {
      showAlert(readableError(err));
      if (button) button.disabled = false;
      if (buttonLabel) buttonLabel.textContent = originalLabel;
    }
  });
}

/* ── Enrollment (stage two) ────────────────────────────────── */

/**
 * Wires the enrollment controls that appear once a class is
 * scheduled: pay by card, or apply an access code.
 *
 * The access code path is deliberately separate from Stripe's own
 * promotion code field. A code worth the full seat value enrols the
 * person server side without a checkout session, so a comped seat
 * never renders as a zero-dollar transaction and the offer keeps
 * its stated value.
 */
export function mountEnrollment({ slug, root }) {
  const emailInput = root.querySelector('[data-enroll-email]');
  const codeInput = root.querySelector('[data-enroll-code]');
  const payButton = root.querySelector('[data-enroll-pay]');
  const codeButton = root.querySelector('[data-enroll-redeem]');
  const alert = root.querySelector('[data-form-alert]');

  const fail = (msg) => {
    if (!alert) return;
    alert.textContent = msg;
    alert.classList.add('show');
  };
  const busy = (btn, on, label) => {
    if (!btn) return;
    btn.disabled = on;
    btn.dataset.original = btn.dataset.original || btn.textContent;
    btn.textContent = on ? label : btn.dataset.original;
  };

  const email = () => emailInput?.value.trim() || '';
  const validEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email());

  payButton?.addEventListener('click', async () => {
    alert?.classList.remove('show');
    if (!validEmail()) return fail('Enter the email address you signed up with.');
    busy(payButton, true, 'Opening checkout...');
    try {
      const { url } = await callFn('startCheckout', { slug, email: email() });
      location.href = url;
    } catch (err) {
      fail(readableError(err));
      busy(payButton, false);
    }
  });

  codeButton?.addEventListener('click', async () => {
    alert?.classList.remove('show');
    if (!validEmail()) return fail('Enter the email address you signed up with.');
    const code = codeInput?.value.trim();
    if (!code) return fail('Enter your access code.');

    busy(codeButton, true, 'Checking...');
    try {
      const result = await callFn('redeemAccessCode', { slug, email: email(), code });
      if (result.enrolled) {
        root.innerHTML =
          '<div class="form-success" style="display:flex;">' +
          '<div class="success-icon">✓</div>' +
          '<div class="success-title">Your seat is <span class="red">confirmed</span></div>' +
          '<div class="success-desc">Check your email. Two messages are on the way: your confirmation, and the one step to set up your portal access before we start.</div>' +
          '</div>';
      } else {
        location.href = result.url;
      }
    } catch (err) {
      fail(readableError(err));
      busy(codeButton, false);
    }
  });
}

/* ── Shared page behaviour ─────────────────────────────────── */

export function initConsentToggles(scope = document) {
  scope.querySelectorAll('[data-consent]').forEach((box) => {
    const item = box.closest('.consent-item') || box;
    const toggle = () => box.classList.toggle('checked');
    item.addEventListener('click', toggle);
    box.setAttribute('role', 'checkbox');
    box.setAttribute('tabindex', '0');
    box.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
    });
  });
}

export function initScrollReveal(scope = document) {
  const targets = scope.querySelectorAll('.fade-up, .stagger-list');
  if (!targets.length) return;
  const obs = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          obs.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );
  targets.forEach((el) => obs.observe(el));
}

export { esc };
