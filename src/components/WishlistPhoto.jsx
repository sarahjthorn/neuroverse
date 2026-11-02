import { posterBackground, showsPhoto } from './wishlistUtils'

// An item's photo, or a category-coloured poster with its name (see
// showsPhoto for when a photo is used). Photos come from the shop link given
// when an item moves to Ready to buy - see ReadyLinkPrompt in
// WishlistSpotlight.jsx.
function WishlistPhoto({ item, size = 'tile' }) {
  const photo = showsPhoto(item)
  return (
    <div
      className={`wl-photo wl-photo--${size}${photo ? '' : ' is-poster'}`}
      style={photo ? undefined : { background: posterBackground(item) }}
    >
      {photo
        ? <img src={item.image_url} alt={item.name} draggable={false} />
        : <span className="wl-poster-name" aria-hidden={size !== 'tile'}>{item.name}</span>}
    </div>
  )
}

export default WishlistPhoto
