// Which tabs the top nav shows. The core four are always there; everything
// else is optional, switched on from the "+" at the end of the nav (TopNav's
// TabPicker) so a new brain isn't overwhelming. Which ones are on is stored
// server-side (server/routes/tabs.js, `enabled_tabs` setting).
//
// To add an optional tab: add it here with status 'soon' while it's being
// planned, then flip to 'ready' and add its id to AVAILABLE in
// server/routes/tabs.js once it's built.

export const CORE_TABS = [
  { id: 'home', label: 'Home' },
  { id: 'explore', label: 'Explore' },
  { id: 'memories', label: 'Memories' },
  { id: 'reflect', label: 'Reflect' }
]

export const OPTIONAL_TABS = [
  {
    id: 'wishlist',
    label: 'Wishlist',
    status: 'ready',
    description: 'Things you\'re thinking of buying, with photos and side-by-side pros and cons when you\'re choosing.'
  },
  {
    id: 'axon',
    label: 'Axon',
    status: 'ready',
    description: 'Your daily options, sorted by impact, effort or time, with Axon the creature (it highlights your current tab, and here whatever you select), XP and your 14-day streak.'
  },
  {
    id: 'finance',
    label: 'Finance',
    status: 'soon',
    description: 'Spending and budgets, fed by what you buy off your wishlist and the money goals the brain knows about.'
  },
  {
    id: 'routines',
    label: 'Routines',
    status: 'soon',
    description: 'Things you do regularly, like the gym, running club or supplements, spotted from your chats.'
  },
  {
    id: 'calendar',
    label: 'Calendar',
    status: 'soon',
    description: 'Your routines turned into time in your week, synced with Google, Apple or Outlook.'
  },
  {
    id: 'reading',
    label: 'Reading',
    status: 'soon',
    description: 'Books and papers you\'re reading or want to, with your Kindle highlights turned into memories.'
  }
]

export const isOptionalTab = id => OPTIONAL_TABS.some(t => t.id === id)
