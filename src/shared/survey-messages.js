// Every user-facing survey message. Shared by the server and the browser, so keep it free of Node-only imports.
// `createMessages(t)` returns the messages in the language of the translator `t`; `messages` is English.
import { format } from './i18n/translate.js';

export function createMessages(t = format) {
  return {
    nameRequired: t('Please enter your name (at least 2 letters).'),
    nameChars: t('Please use letters, spaces, apostrophes, periods or hyphens in your name.'),
    nameTooLong: t('Your name can be up to 80 characters.'),
    emailRequired: t('Please enter your email address.'),
    emailInvalid: t("That email doesn't look right. Please check it, e.g. name@example.com."),
    mobileInvalid: t('Please enter a 10-digit US mobile number, e.g. 617-555-0123.'),
    daysRequired: t('Please pick at least one day you could attend.'),
    likelihoodRequired: (dayLabel) => t('Please tell us how likely you are to attend on {day}.', { day: t(dayLabel) }),
    likelihoodQuestion: (dayLabel) => t('How likely are you to attend on {day}?', { day: t(dayLabel) }),
    headcountWhole: t('Please enter a whole number.'),
    headcountRange: (band) =>
      band.min > 0
        ? t('{label} must be between {min} and {max}.', { label: t(band.label), min: band.min, max: band.max })
        : t('Please enter a number from {min} to {max}.', { min: band.min, max: band.max }),
    groupTooLarge: (max) => t("That's a large group. For more than {max} people, please contact the organizers.", { max }),
    foodRequired: t('Please choose a food preference.'),
    culturalRequired: t("Please tell us if you're interested in a cultural performance."),
    contributionRequired: t("Please choose a contribution amount you're comfortable with."),
    rolesInvalid: t('Please choose from the listed volunteer roles.'),
    commentsTooLong: (max, length) => t('Comments can be up to {max} characters (you have {length}).', { max, length }),
    commentsCounter: (length, max) => `${length} / ${max}`,
    consentRequired: t('Please agree so organizers can contact you about the event.'),
    consentText: (eventName) =>
      t("I agree that organizers may contact me by email, phone or WhatsApp about {event}. My details are visible only to organizers and won't be shared.", { event: eventName }),
    errorSummary: (count) =>
      count === 1
        ? t('Please fix the highlighted field below.')
        : t('Please fix the {count} highlighted fields below.', { count }),

    notOpen: (eventName, opensText) => t('The {event} interest survey opens on {opens}.', { event: eventName, opens: opensText }),
    noOpenSurveys: t('There are no open surveys right now. Please check back later.'),
    savedNew: (name, eventName) => t("Thank you, {name}! Your family's response for {event} has been saved.", { name, event: eventName }),
    savedUpdated: (name, eventName) => t("Thank you, {name}! We've updated your family's response for {event}.", { name, event: eventName }),
    saveLink: (closesText) => t('Save this link to change your answers until {closes}.', { closes: closesText }),
    emailed: (email) => t("We've also emailed this link to {email}.", { email }),
    emailReadOnly: t('To change your email, please contact the organizers.'),
    invalidLink: t("This edit link isn't valid anymore. Please use your latest link, or fill in the survey again."),

    turnstileFailed: t("We couldn't confirm you're not a robot. Please try again."),
    turnstileUnreachable: t("We couldn't reach our spam check. Please try again in a minute."),
    turnstileMisconfigured: t("Our spam check isn't set up correctly. Please contact the organizers."),
    turnstileNotConfigured: 'Turnstile is not configured - public forms rely on the honeypot and rate limits only.',
    turnstileTestKeys: "Turnstile is using Cloudflare test keys - the widget shows 'For testing only' and does not protect the form.",
    honeypotThanks: t('Thank you! Your response has been received.'),
    tooManySubmissions: t('Too many submissions from your network. Please try again in an hour.'),
    tooFast: t("You're going a bit fast. Please wait a minute and try again."),
    tooLarge: t('That submission is too large. Please shorten your comments and try again.'),

    emailSubject: (eventName) => t('Your {event} survey link', { event: eventName }),
    emailNotYou: t("If you didn't fill in this survey, please reply to this email."),

    pongalGreeting: 'இனிய பொங்கல் நல்வாழ்த்துக்கள்',
    sections: {
      about: { ta: 'உங்களைப் பற்றி', en: t('About you') },
      attending: { ta: 'வருகை', en: t('Attending') },
      food: { ta: 'உணவும் உதவியும்', en: t('Food & helping') },
      finish: { ta: 'நிறைவு', en: t('Finish') },
    },
  };
}

export const messages = createMessages();
