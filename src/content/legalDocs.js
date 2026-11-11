/**
 * Text of the four policies shown at /privacy, /terms, /tracking-policy and
 * /cookies. Written in plain English for employees and HR users.
 *
 * Formatting inside strings:  **bold**   [link text](/path)   {{value}}
 * {{value}} comes from src/constants/legal.js (contact details, retention
 * periods). Keep this text in step with what the app actually does.
 *
 * Block types: { p }, { ul: [] }, { table: { head: [], rows: [[]] } }
 */

const CONTACT_BLOCK = [
  { ul: [
    'Email: {{email}}',
    'Phone: {{phone}}',
    'Address: {{address}}',
    'Data protection contact: {{officer}}',
  ] },
]

export const LEGAL_DOCS = [
  // ------------------------------------------------------------------------
  {
    id: 'privacy',
    path: '/privacy',
    title: 'Privacy Policy',
    short: 'Privacy',
    summary: 'What personal data the attendance app collects about you, why, who can see it and your rights.',
    sections: [
      {
        id: 'who',
        heading: 'Who we are',
        blocks: [
          { p: 'This policy covers the Workforce Attendance app used by staff of {{employers}} ("we", "us"). Your employer is responsible for your personal data (the "data controller"). Registered company names: {{employerLegalNames}}.' },
          { p: 'We follow the Data Protection Act, 2012 (Act 843) of Ghana. Our registration number with the Data Protection Commission is {{dpcRegistration}}.' },
        ],
      },
      {
        id: 'collect',
        heading: 'What we collect',
        blocks: [
          { table: {
            head: ['Data', 'When', 'Why'],
            rows: [
              ['Name, phone number, email (optional), home address (optional), emergency contact (optional)', 'At registration', 'To identify you and contact you or your emergency contact'],
              ['Company, position, Staff ID, allocated shop', 'At registration and when HR updates it', 'To run attendance, shifts and field work'],
              ['Salary payment method (Table Top, Mobile Money or Bank)', 'At registration', 'To pay you'],
              ['Face photo', 'At registration', 'To check that the person clocking in is really you'],
              ['Face scans', 'Each time you clock in, clock out, take a break or record a visit', 'Compared with your registered photo, then not kept as a photo'],
              ['Clock-in, clock-out, break and late times', 'Each scan', 'Attendance, lateness, overtime and pay'],
              ['Failed face scans', 'When a scan does not match', 'To stop people clocking in for someone else'],
              ['Outlet visits: outlet, time, phone GPS location', 'When a Sales Rep or Supervisor records a visit', 'To confirm the visit happened at the outlet'],
              ['Live location', 'Supervisors, Sales Reps and Merchandisers, only between clock-in and clock-out', 'See the [Tracking Policy](/tracking-policy)'],
              ['Merchandiser verification checks (SMS reply, location, face check)', 'Up to three times per shift', 'To confirm Merchandisers are at their allocated shop'],
              ['Leave, holidays, shifts, overtime and HR corrections', 'When HR records them', 'Attendance and pay records'],
              ['HR user accounts and their actions', 'When HR staff use the HR portal', 'Security and an audit trail of who changed what'],
            ],
          } },
          { p: 'We do not collect your contacts, photos, messages, browsing history or any other data from your phone.' },
        ],
      },
      {
        id: 'face',
        heading: 'Your face photo and face scans',
        blocks: [
          { p: 'Your face photo is sensitive personal data. We use it only to confirm your identity when you scan. It is never used for anything else and never shared outside the company, except with a service provider that runs the check for us under contract.' },
          { p: '**Automatic decision:** if a face scan fails **5 times in one day** for the same Staff ID, the system marks that Staff ID **absent for the day**. If this happens and you believe it is wrong (for example a poor camera or bad light), tell HR. HR will review it and can correct your attendance.' },
        ],
      },
      {
        id: 'basis',
        heading: 'Why we are allowed to use it',
        blocks: [
          { ul: [
            '**Your employment contract** — attendance, pay and field work need these records.',
            '**Legal duties** — keeping employment and pay records required by Ghanaian law.',
            '**Legitimate interests** — preventing attendance fraud, keeping staff safe in the field and protecting company property, balanced against your privacy.',
            '**Your consent** — for location sharing on your phone, which you give through your phone\'s location permission and can withdraw (see the [Tracking Policy](/tracking-policy)).',
          ] },
        ],
      },
      {
        id: 'who-sees',
        heading: 'Who can see your data',
        blocks: [
          { ul: [
            '**HR staff of your company**, only for the parts of the HR portal they are allowed to use. An HR user can only see the companies they manage. Every change is recorded in an audit log.',
            '**Service providers** who host the system or send verification SMS for us, under contracts that require them to protect your data and use it only for us.',
            '**Authorities**, only when the law requires it.',
          ] },
          { p: 'We do not sell your data, and we do not use it for advertising.' },
        ],
      },
      {
        id: 'third',
        heading: 'Outside services the app uses',
        blocks: [
          { ul: [
            '**Google Fonts** supplies the app\'s lettering. Your phone or computer downloads it from Google, so Google receives your IP address. No employee data is sent.',
            '**OpenStreetMap** supplies map images and place search in the HR Live Tracker, when HR switches the street map on. The map areas HR views are sent to OpenStreetMap; no employee data is sent.',
          ] },
          { p: 'These services may be located outside Ghana.' },
        ],
      },
      {
        id: 'keep',
        heading: 'How long we keep it',
        blocks: [
          { table: {
            head: ['Data', 'Kept'],
            rows: [
              ['Your employee record', '{{retention.employeeRecord}}'],
              ['Face photo', '{{retention.facePhoto}}'],
              ['Attendance records', '{{retention.attendance}}'],
              ['Outlet visits and verification checks', '{{retention.visits}}'],
              ['Detailed live-location trail', '{{retention.liveTrail}}'],
              ['Daily tracking summary (time tracked, coverage, distance — no positions)', '{{retention.trackingSummary}}'],
              ['Failed face-scan count', '{{retention.failedScans}}'],
              ['Audit log', '{{retention.auditLog}}'],
              ['HR user accounts', '{{retention.hrAccounts}}'],
            ],
          } },
        ],
      },
      {
        id: 'security',
        heading: 'How we protect it',
        blocks: [
          { ul: [
            'The app is served only over an encrypted connection (https).',
            'HR access is by named account, limited by role and company, with a lock after repeated failed sign-ins.',
            'Changes to attendance are recorded in an audit log that cannot be edited.',
            'Some data (for example your sign-in to this phone and the app\'s offline copy) is stored on the device. See the [Cookie Policy](/cookies).',
          ] },
          { p: 'If a security breach affects your data, we will tell you and the Data Protection Commission as the law requires.' },
        ],
      },
      {
        id: 'rights',
        heading: 'Your rights',
        blocks: [
          { p: 'Under the Data Protection Act, 2012 you can:' },
          { ul: [
            'ask for a copy of the personal data we hold about you;',
            'ask us to correct data that is wrong or incomplete, or delete data we no longer need;',
            'object to a use of your data that causes you harm or distress;',
            'ask for a person to review an automatic decision, such as being marked absent after failed face scans;',
            'withdraw your consent to location sharing (see the [Tracking Policy](/tracking-policy));',
            'complain to the **Data Protection Commission, Ghana** if you are unhappy with how we handle your data.',
          ] },
          { p: 'To use any of these rights, contact us using the details below. We will reply within 21 days.' },
        ],
      },
      { id: 'contact', heading: 'Contact us', blocks: CONTACT_BLOCK },
      {
        id: 'changes',
        heading: 'Changes to this policy',
        blocks: [{ p: 'If we change this policy we will update the date below and tell staff about important changes before they take effect.' }],
      },
    ],
  },

  // ------------------------------------------------------------------------
  {
    id: 'tracking',
    path: '/tracking-policy',
    title: 'Location Tracking Policy',
    short: 'Tracking',
    summary: 'When your location is tracked, what is recorded, who sees it and when it stops.',
    sections: [
      {
        id: 'summary',
        heading: 'In short',
        blocks: [
          { ul: [
            '**Who:** Supervisors, Sales Representatives and Merchandisers only. Other staff are never tracked.',
            '**When:** only from the moment you **clock in** until you **clock out**. Tracking stops at clock-out, and the system refuses any location sent after it.',
            '**Never:** before clock-in, after clock-out, on days you do not work, or while you are on leave.',
            '**You can always see it:** while your location is being shared, the app shows a "Location sharing is on" bar.',
          ] },
        ],
      },
      {
        id: 'why',
        heading: 'Why we track field staff',
        blocks: [
          { ul: [
            'to confirm field work and outlet visits happen where and when they are recorded;',
            'to plan and support field work (for example sending the nearest person to a shop);',
            'to help keep staff safe while working away from the office;',
            'to prevent attendance fraud.',
          ] },
          { p: 'We do not use location to monitor your private life, and we do not track you outside working time.' },
        ],
      },
      {
        id: 'what',
        heading: 'What is recorded',
        blocks: [
          { ul: [
            '**Live location** while clocked in: your phone\'s GPS position, its accuracy and the time. A new point is saved when you move about 15 metres or more, and at most every 20 seconds.',
            '**Outlet visits** (Sales Reps and Supervisors): the phone\'s location at the moment you record a visit.',
            '**Shop visit proof** (Sales Reps and Supervisors): you have a list of shops to visit every working day. A visit to a listed shop counts as proven when your face scan was inside the shop area **and** your live location stayed near the shop for at least 10 minutes. Visits that cannot be proven are shown to HR for review.',
            '**Verification checks** (Merchandisers): up to three checks per shift at unpredictable times, each asking for your location and a face check, to confirm you are within 150 metres of your allocated shop.',
          ] },
          { p: 'Nothing else on your phone is read.' },
        ],
      },
      {
        id: 'how',
        heading: 'How it works on your phone',
        blocks: [
          { ul: [
            'Before your first clock-in the app explains location sharing. Your phone will ask you to allow location for the app.',
            'Your location is sent only while you have mobile data (or Wi-Fi) and Location (GPS) turned on.',
            'In the current web version, your location is sent only while the Attendance app is open on screen. If you lock the phone or switch to another app, sharing pauses until you open it again.',
          ] },
        ],
      },
      {
        id: 'who',
        heading: 'Who can see your location',
        blocks: [
          { p: 'Only HR staff of your company who have access to the Live Tracker. They see your latest position and status (for example "Clocked in — live" or "signal lost"). The detailed trail of your movements is kept {{retention.liveTrail}}; outlet visit and verification locations are kept {{retention.visits}} as part of your work records.' },
        ],
      },
      {
        id: 'report',
        heading: 'Daily tracking report',
        blocks: [
          { p: 'At the end of each day the detailed trail is replaced by a short summary: your clock-in and clock-out times, how long you were tracked, how much of that time your phone was sending its location, how often the signal was lost, the distance travelled and, for Sales Reps and Supervisors, how many minutes you spent near each shop on your list. The summary contains **no positions**. HR uses it in a daily report, and it is kept {{retention.trackingSummary}} with your attendance records.' },
        ],
      },
      {
        id: 'off',
        heading: 'If location is off or not received',
        blocks: [
          { p: 'If your phone has no mobile data, has Location turned off, or the app is closed, HR will see "signal lost". A missing signal on its own is **not** treated as absence or misconduct — there are many innocent reasons (no network, flat battery). HR may ask you about it.' },
          { p: 'You can withdraw permission at any time in your phone\'s settings. Because location is part of how field work is confirmed, please speak to HR first so another way of confirming your work can be agreed.' },
        ],
      },
      {
        id: 'rights',
        heading: 'Your rights',
        blocks: [
          { p: 'You can ask to see the location records we hold about you, ask for wrong records to be corrected, and complain to us or to the Data Protection Commission. See the [Privacy Policy](/privacy) for details.' },
        ],
      },
      { id: 'contact', heading: 'Contact us', blocks: CONTACT_BLOCK },
    ],
  },

  // ------------------------------------------------------------------------
  {
    id: 'terms',
    path: '/terms',
    title: 'Terms and Conditions',
    short: 'Terms',
    summary: 'The rules for using the Workforce Attendance app and the HR portal.',
    sections: [
      {
        id: 'about',
        heading: 'About these terms',
        blocks: [
          { p: 'These terms apply to everyone who uses the Workforce Attendance app and HR portal provided by {{employers}}. By registering, clocking in or signing in to the HR portal, you agree to them.' },
          { p: 'These terms sit alongside your employment contract and company policies. If they conflict, your employment contract and the law come first.' },
        ],
      },
      {
        id: 'employees',
        heading: 'Rules for employees',
        blocks: [
          { ul: [
            'Use **only your own Staff ID and your own face**. Never clock in or out for anyone else, or let anyone do it for you.',
            'Give true information at registration and tell HR when your details change.',
            'Do not use fake-location apps, photos or videos of a face, or any other trick to fool the face check or location.',
            'Record outlet visits only when you are actually at the outlet. Sales Reps and Supervisors: scan when you arrive at each shop on your daily list and stay at least 10 minutes with the app open and Location on, so the visit can be proven.',
            'Clock out at the end of your working day. Field staff: clocking out also stops location tracking.',
          ] },
        ],
      },
      {
        id: 'rules',
        heading: 'How attendance is recorded',
        blocks: [
          { ul: [
            'One clock-in and one clock-out per day, within the times your company sets. A clock-in after the start time is recorded as late.',
            'Warehouse Workers record breaks with "Going on break" and "Back from break". Break time does not count as working time.',
            'After **5 failed face scans** in one day, the Staff ID is marked **absent** for that day. Speak to HR if you think this was a mistake; HR can review and correct it.',
            'HR can correct attendance records. Every correction is recorded with the reason and who made it.',
          ] },
        ],
      },
      {
        id: 'hr',
        heading: 'Rules for HR users',
        blocks: [
          { ul: [
            'Keep your sign-in details private. Do not share your account.',
            'Use employee data only for your HR duties, and only for the companies you manage.',
            'Do not copy, export or share employee data except for an approved work purpose.',
            'Give a true reason for every correction. Your actions are recorded in the audit log.',
          ] },
        ],
      },
      {
        id: 'misuse',
        heading: 'Misuse',
        blocks: [{ p: 'Breaking these terms — especially clocking in for someone else or faking a location — may lead to action under your company\'s disciplinary procedure, and loss of access to the app.' }],
      },
      {
        id: 'availability',
        heading: 'Availability',
        blocks: [{ p: 'We aim to keep the app working at all times but cannot promise it will never be unavailable. If you cannot clock in because the app is down, tell your supervisor or HR straight away so your attendance can be recorded another way.' }],
      },
      {
        id: 'privacy',
        heading: 'Your privacy',
        blocks: [{ p: 'How we use your data is explained in the [Privacy Policy](/privacy), the [Location Tracking Policy](/tracking-policy) and the [Cookie Policy](/cookies).' }],
      },
      {
        id: 'law',
        heading: 'Changes and governing law',
        blocks: [
          { p: 'We may update these terms. We will tell staff about important changes before they take effect.' },
          { p: 'These terms are governed by the laws of the Republic of Ghana.' },
        ],
      },
      { id: 'contact', heading: 'Contact us', blocks: CONTACT_BLOCK },
    ],
  },

  // ------------------------------------------------------------------------
  {
    id: 'cookies',
    path: '/cookies',
    title: 'Cookie Policy',
    short: 'Cookies',
    summary: 'The app uses no cookies. This explains what it stores on your device instead.',
    sections: [
      {
        id: 'summary',
        heading: 'In short',
        blocks: [
          { p: 'The Workforce Attendance app **does not use cookies**, and it has **no advertising or analytics tracking**. It does store a small amount of information on your phone or computer so that it works. Because this is needed for the app to work, it is not optional.' },
        ],
      },
      {
        id: 'stored',
        heading: 'What the app stores on your device',
        blocks: [
          { table: {
            head: ['What', 'Why', 'How long'],
            rows: [
              ['That a registration was completed on this device', 'So returning staff go straight to attendance', 'Until you clear the app\'s data'],
              ['Which Staff ID is sharing location on this phone', 'So location sharing continues if the app is reopened, and stops at clock-out', 'Removed at clock-out'],
              ['HR sign-in session', 'To keep an HR user signed in', 'Until sign-out'],
              ['HR display choices (for example the Live Tracker map style)', 'To remember settings', 'Until you clear the app\'s data'],
              ['An offline copy of the app\'s files', 'So the app opens quickly and on a weak connection', 'Replaced when the app is updated'],
            ],
          } },
        ],
      },
      {
        id: 'third',
        heading: 'Other websites',
        blocks: [
          { p: 'The app loads its lettering from **Google Fonts**, and the HR Live Tracker loads maps from **OpenStreetMap** when the street map is switched on. These services receive your device\'s IP address to deliver their files. The app does not ask them to set cookies, but their own policies apply.' },
        ],
      },
      {
        id: 'control',
        heading: 'How to remove it',
        blocks: [
          { p: 'You can clear the app\'s stored data in your browser or phone settings (Site settings → Clear data, or remove the app from your home screen). You will then need to sign in again, and field staff should open the app again after clearing so location sharing can resume while clocked in.' },
          { p: 'If we ever add cookies or analytics, we will update this policy and ask for your consent where the law requires it.' },
        ],
      },
      { id: 'contact', heading: 'Contact us', blocks: CONTACT_BLOCK },
    ],
  },
]

export const LEGAL_PATHS = Object.fromEntries(LEGAL_DOCS.map((d) => [d.path, d.id]))
