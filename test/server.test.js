// API smoke tests: every page's read routes answer on an empty brain, and
// the free write paths (wishlist, tabs, intro) work end to end.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startServer, api } from './helpers.js'

let server
before(async () => { server = await startServer() })
after(async () => { await server?.stop() })

test('read routes answer on an empty brain', async () => {
  const { base } = server

  const graph = await api(base, '/graph')
  assert.deepEqual(graph.nodes, [])
  assert.deepEqual(graph.edges, [])

  assert.equal((await api(base, '/graph/signature')).signature, '0|')

  const categories = await api(base, '/categories')
  assert.equal(JSON.stringify(categories).includes('Career'), true)

  const overview = await api(base, '/overview')
  assert.equal(overview.total, 0)

  const intro = await api(base, '/intro')
  assert.equal(intro.completed, false)
  assert.equal(intro.name, null)

  assert.deepEqual((await api(base, '/tabs')).enabled, [])
  assert.deepEqual((await api(base, '/wishlist')).items, [])
  await api(base, '/questions')
  await api(base, '/stats/digests')
  await api(base, '/nodes/does-not-exist', { status: 404 })
})

test('search and ask on an empty brain need no paid calls', async () => {
  const { base } = server
  const search = await api(base, '/search?q=running')
  assert.deepEqual(search.results, [])

  const ask = await api(base, '/ask', { method: 'POST', body: { question: 'What do I like?' } })
  assert.equal(ask.answer, null)

  await api(base, '/search', { status: 400 })
  await api(base, '/ask', { method: 'POST', body: {}, status: 400 })
})

test('wishlist: add, mention again, choose an option, delete', async () => {
  const { base } = server
  const added = await api(base, '/wishlist', {
    method: 'POST',
    body: { name: 'Fitness watch', categories: ['Health'], keywords: ['running'], why: 'Training' }
  })
  assert.equal(added.created, true)
  const id = added.item.id
  assert.equal(added.item.status, 'idea')

  const again = await api(base, '/wishlist', { method: 'POST', body: { name: 'Fitness watch', option: 'Garmin Forerunner 570' } })
  assert.equal(again.created, false)
  assert.equal(again.item.mention_count ?? again.item.mentionCount, 2)

  const chosen = await api(base, `/wishlist/${id}`, { method: 'PATCH', body: { chooseOption: 'Garmin Forerunner 570' } })
  assert.equal((chosen.item ?? chosen).status, 'ready')

  // A tab with data stays on for an existing brain
  assert.deepEqual((await api(base, '/tabs')).enabled, ['wishlist'])

  await api(base, '/wishlist', { method: 'POST', body: {}, status: 400 })
  await api(base, `/wishlist/${id}`, { method: 'DELETE' })
  assert.deepEqual((await api(base, '/wishlist')).items, [])
})

test('inbox: add options, note required for series steps, XP on done', async () => {
  const { base } = server
  const added = await api(base, '/inbox', {
    method: 'POST',
    body: {
      source: 'axon-morning-plan',
      expireOld: true,
      items: [
        { title: 'Draft "Why Anthropic?"', category: 'career', impact: 3, effort: 3, minutes: 40, series: 'Why Anthropic? answer' },
        { title: 'Wipe down the kitchen', category: 'Personal', impact: 1, effort: 1, minutes: 10 }
      ]
    }
  })
  assert.equal(added.created.length, 2)
  const [draft, chore] = added.created
  assert.equal(draft.category, 'Career')
  assert.equal(draft.needs_note, true)

  // Same open title isn't added twice
  const again = await api(base, '/inbox', { method: 'POST', body: { title: 'Wipe down the kitchen' } })
  assert.equal(again.created.length, 0)

  // why alone replaces the text and leaves the status (deep-think reruns)
  const rewritten = await api(base, `/inbox/${chore.id}`, { method: 'PATCH', body: { why: 'Updated: do it after dinner' } })
  assert.equal(rewritten.item.why, 'Updated: do it after dinner')
  assert.equal(rewritten.item.status, 'new')
  assert.equal(again.existing.length, 1)

  await api(base, `/inbox/${draft.id}`, { method: 'PATCH', body: { status: 'done' }, status: 400 })
  const done = await api(base, `/inbox/${draft.id}`, { method: 'PATCH', body: { status: 'done', note: 'First draft written' } })
  assert.equal(done.item.status, 'done')
  assert.equal(done.stats.xp, 45)
  assert.equal(done.stats.discipline.count, 1)

  // Marking done twice doesn't double the XP
  const twice = await api(base, `/inbox/${draft.id}`, { method: 'PATCH', body: { status: 'done' } })
  assert.equal(twice.stats.xp, 45)

  // done -> later -> done again still only counts once
  await api(base, `/inbox/${draft.id}`, { method: 'PATCH', body: { status: 'later' } })
  const redone = await api(base, `/inbox/${draft.id}`, { method: 'PATCH', body: { status: 'done' } })
  assert.equal(redone.stats.xp, 45)

  const later = await api(base, `/inbox/${chore.id}`, { method: 'PATCH', body: { status: 'later', started: true } })
  assert.equal(later.item.status, 'later')
  assert.ok(later.item.started_at)

  // Only web links are kept as start links
  const odd = await api(base, '/inbox', { method: 'POST', body: { title: 'Odd link', startUrl: 'javascript:alert(1)' } })
  assert.equal(odd.created[0].start_url, null)
  await api(base, `/inbox/${odd.created[0].id}`, { method: 'PATCH', body: { status: 'rejected' } })

  await api(base, '/inbox', { method: 'POST', body: {}, status: 400 })
  await api(base, `/inbox/${chore.id}`, { method: 'PATCH', body: { status: 'nope' }, status: 400 })
  // Recent: open items plus the week's done and rejected ones (so the
  // morning plan sees what she turned down)
  const { items } = await api(base, '/inbox')
  assert.deepEqual(items.map(i => i.status).sort(), ['done', 'later', 'rejected'])
})

test('inbox: ideas are capped at 3 a day and give no XP', async () => {
  const { base } = server
  const before = (await api(base, '/inbox')).stats.xp
  const ideas = ['Idea one', 'Idea two', 'Idea three', 'Idea four'].map(title => ({ kind: 'idea', title, why: 'Worth doing', category: 'Project' }))
  const added = await api(base, '/inbox', { method: 'POST', body: { source: 'axon-explore', items: ideas } })
  assert.equal(added.created.length, 3)
  assert.equal(added.created[0].kind, 'idea')
  assert.equal(added.created[0].embedding, undefined)
  assert.deepEqual(added.over_cap, ['Idea four'])

  // The cap is per day, across runs
  const later = await api(base, '/inbox', { method: 'POST', body: { kind: 'idea', title: 'Idea five' } })
  assert.deepEqual(later.over_cap, ['Idea five'])

  // Accepting an idea isn't doing something, so no XP
  const accepted = await api(base, `/inbox/${added.created[0].id}`, { method: 'PATCH', body: { status: 'done' } })
  assert.equal(accepted.stats.xp, before)
})

test('tabs switch on and off', async () => {
  const { base } = server
  assert.deepEqual((await api(base, '/tabs/wishlist', { method: 'PUT', body: { enabled: false } })).enabled, [])
  assert.deepEqual((await api(base, '/tabs/wishlist', { method: 'PUT', body: { enabled: true } })).enabled, ['wishlist'])
  assert.deepEqual((await api(base, '/tabs/axon', { method: 'PUT', body: { enabled: true } })).enabled, ['wishlist', 'axon'])
  assert.deepEqual((await api(base, '/tabs/axon', { method: 'PUT', body: { enabled: false } })).enabled, ['wishlist'])
  await api(base, '/tabs/not-a-tab', { method: 'PUT', body: { enabled: true }, status: 400 })
})

test('intro can be completed', async () => {
  const { base } = server
  await api(base, '/intro/complete', { method: 'POST' })
  assert.equal((await api(base, '/intro')).completed, true)
})
