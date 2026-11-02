// Plain substring match over a node's title/content/keywords, shared by the
// search box (App.jsx) and the Memories page (AllMemoriesView.jsx) so both
// stay in sync rather than drifting into two slightly different matchers.
export function nodeMatchesQuery(node, lowerQuery) {
  const haystack = [node.data.title, node.data.content, ...(node.data.keywords || [])]
    .join(' ')
    .toLowerCase()
  return haystack.includes(lowerQuery)
}
