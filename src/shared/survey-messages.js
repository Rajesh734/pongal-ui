// Every user-facing survey message. Shared by the server and the browser, so keep it free of Node-only imports.

export const messages = {
  nameRequired: 'Please enter your name (at least 2 letters).',
  nameChars: 'Please use letters, spaces, apostrophes, periods or hyphens in your name.',
  nameTooLong: 'Your name can be up to 80 characters.',
  emailRequired: 'Please enter your email address.',
  emailInvalid: "That email doesn't look right. Please check it, e.g. name@example.com.",
  mobileInvalid: 'Please enter a 10-digit US mobile number, e.g. 617-555-0123.',
  daysRequired: 'Please pick at least one day you could attend.',
  likelihoodRequired: (dayLabel) => `Please tell us how likely you are to attend on ${dayLabel}.`,
  likelihoodQuestion: (dayLabel) => `How likely are you to attend on ${dayLabel}?`,
  headcountWhole: 'Please enter a whole number.',
  headcountRange: (band) =>
    band.min > 0
      ? `${band.label} must be between ${band.min} and ${band.max}.`
      : `Please enter a number from ${band.min} to ${band.max}.`,
  groupTooLarge: (max) => `That's a large group. For more than ${max} people, please contact the organizers.`,
  foodRequired: 'Please choose a food preference.',
  culturalRequired: "Please tell us if you're interested in a cultural performance.",
  contributionRequired: "Please choose a contribution amount you're comfortable with.",
  rolesInvalid: 'Please choose from the listed volunteer roles.',
  commentsTooLong: (max, length) => `Comments can be up to ${max} characters (you have ${length}).`,
  commentsCounter: (length, max) => `${length} / ${max}`,
  consentRequired: 'Please agree so organizers can contact you about the event.',
  consentText: (eventName) =>
    `I agree that organizers may contact me by email, phone or WhatsApp about ${eventName}. My details are visible only to organizers and won't be shared.`,
  errorSummary: (count) =>
    count === 1 ? 'Please fix the highlighted field below.' : `Please fix the ${count} highlighted fields below.`,

  notOpen: (eventName, opensText) => `The ${eventName} interest survey opens on ${opensText}.`,
  noOpenSurveys: 'There are no open surveys right now. Please check back later.',
  savedNew: (name, eventName) => `Thank you, ${name}! Your family's response for ${eventName} has been saved.`,
  savedUpdated: (name, eventName) => `Thank you, ${name}! We've updated your family's response for ${eventName}.`,
  saveLink: (closesText) => `Save this link to change your answers until ${closesText}.`,
  emailed: (email) => `We've also emailed this link to ${email}.`,
  emailReadOnly: 'To change your email, please contact the organizers.',
  invalidLink: "This edit link isn't valid anymore. Please use your latest link, or fill in the survey again.",

  turnstileFailed: "We couldn't confirm you're not a robot. Please try again.",
  turnstileUnreachable: "We couldn't reach our spam check. Please try again in a minute.",
  turnstileMisconfigured: "Our spam check isn't set up correctly. Please contact the organizers.",
  turnstileNotConfigured: 'Turnstile is not configured - public forms rely on the honeypot and rate limits only.',
  turnstileTestKeys: "Turnstile is using Cloudflare test keys - the widget shows 'For testing only' and does not protect the form.",
  honeypotThanks: 'Thank you! Your response has been received.',
  tooManySubmissions: 'Too many submissions from your network. Please try again in an hour.',
  tooFast: "You're going a bit fast. Please wait a minute and try again.",
  tooLarge: 'That submission is too large. Please shorten your comments and try again.',

  emailSubject: (eventName) => `Your ${eventName} survey link`,
  emailNotYou: "If you didn't fill in this survey, please reply to this email.",

  pongalGreeting: 'இனிய பொங்கல் நல்வாழ்த்துக்கள்',
  sections: {
    about: { ta: 'உங்களைப் பற்றி', en: 'About you' },
    attending: { ta: 'வருகை', en: 'Attending' },
    food: { ta: 'உணவும் உதவியும்', en: 'Food & helping' },
    finish: { ta: 'நிறைவு', en: 'Finish' },
  },
};
