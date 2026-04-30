const API = "http://localhost:7842";

let library = [];
let currentTrackId = null;
let isLoading = false;
let _trendingCache = null;
let _trendingCacheTime = 0;
let _prevVol = 1;
const TRENDING_TTL = 60 * 60 * 1000;
const audio = document.getElementById("audio");
const searchInput = document.getElementById("urlInput");
const dropdown = document.getElementById("searchDropdown");
const toast = document.getElementById("toast");

function showToast(msg, isError = false) {
  toast.textContent = msg;
  toast.classList.add("show");
  toast.classList.toggle("success", !isError);
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function saveName() {
  const input = document.getElementById('nameInput');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  localStorage.setItem('sonix_user_name', name);
  document.getElementById('nameModal').style.display = 'none';
  showGreeting(name);
}

function showGreeting(name) {
  const el = document.getElementById('topbarGreeting');
  el.innerHTML = `<div class="greeting-text" onclick="editName()" title="Edit name">Hi, <span>${name}</span><i class="fas fa-pen greeting-edit"></i></div>`;
}

function editName() {
  const modal = document.getElementById('nameModal');
  const input = document.getElementById('nameInput');
  input.value = localStorage.getItem('sonix_user_name') || '';
  modal.style.display = 'flex';
  setTimeout(() => input.focus(), 100);
}

function checkName() {
  const name = localStorage.getItem('sonix_user_name');
  if (name) {
    document.getElementById('nameModal').style.display = 'none';
    showGreeting(name);
  } else {
    document.getElementById('nameModal').style.display = 'flex';
    setTimeout(() => document.getElementById('nameInput').focus(), 300);
  }
}

// allow Enter key to submit
document.getElementById('nameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveName();
});


async function init() {
  checkName();
  showSection("library");
  const cached = localStorage.getItem("library_cache");
  if (!cached) renderSkeleton();
  await Promise.all([fetchLibrary(), loadFavouriteIds(), loadPlaylists()]);
  fetch(`${API}/trending`).then(r => r.json()).then(d => { _trendingCache = d; _trendingCacheTime = Date.now(); }).catch(() => {});
}

function showSection(name) {
  ["library","trending","artist","favourites","playlists","playlist-detail"].forEach(s => {
    document.getElementById(`section-${s}`).style.display = s === name ? "block" : "none";
    const nav = document.getElementById(`nav-${s}`);
    if (nav) nav.classList.toggle("active", s === name);
  });
  document.querySelector(".main-content").scrollTop = 0;
  // sync navbar accent color to section
  const sectionColors = {
    library:  {color: "#ffde22", glow: "rgba(255,222,34,0.18)", icon: "fa-compact-disc", label: "Library"},
    trending: {color: "#ff4e4e", glow: "rgba(255,78,78,0.18)",  icon: "fa-fire",          label: "Trending"},
    favourites: {color: "#ff6eb4", glow: "rgba(255,110,180,0.18)", icon: "fa-heart",      label: "Favourites"},
    playlists: {color: "#4ecaff", glow: "rgba(78,202,255,0.18)",  icon: "fa-list",        label: "Playlists"},
    artist:   {color: "#a78bfa", glow: "rgba(167,139,250,0.18)", icon: "fa-microphone",   label: "Artist"},
  };
  const sc = sectionColors[name] || sectionColors.library;
  document.documentElement.style.setProperty("--nav-active-color", sc.color);
  document.documentElement.style.setProperty("--nav-active-glow", sc.glow);
  const titleEl = document.getElementById("topbarTitle");
  if (titleEl) titleEl.innerHTML = `<i class="fas ${sc.icon}"></i> ${sc.label}`;
  if (name === "trending") { _trendingCache = null; loadTrending(); }
  if (name === "favourites") renderFavourites();
  if (name === "playlists") loadPlaylists().then(renderPlaylists);
}

async function showArtist(artist) {
  showSection("artist");
  const grid = document.getElementById("artistGrid");
  grid.innerHTML = `
    <div class="artist-header">
      <button class="back-btn" onclick="showSection('library')"><i class="fas fa-arrow-left"></i> Back</button>
      <h2 class="artist-title">${escapeHtml(artist)}</h2>
    </div>
    <table class="library-table">
      <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
      <tbody>${Array(10).fill(0).map(() => `
        <tr class="lib-row visible">
          <td class="lib-thumb"><div class="skel skel-thumb"></div></td>
          <td class="lib-name"><div class="skel skel-title"></div></td>
          <td class="lib-artist"><div class="skel skel-artist"></div></td>
          <td></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  try {
    const res = await fetch(`${API}/artist_songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist }),
    });
    const tracks = await res.json();
    grid.innerHTML = `
      <div class="artist-header">
        <button class="back-btn" onclick="showSection('library')"><i class="fas fa-arrow-left"></i> Back</button>
        <h2 class="artist-title">${escapeHtml(artist)}</h2>
      </div>
      <table class="library-table">
        <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
        <tbody>${tracks.map((t) => `
          <tr class="lib-row" onclick="streamDirect('${t.videoId}','${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}')">
            <td class="lib-thumb"><img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://i.ytimg.com/vi/default/mqdefault.jpg'" /></td>
            <td class="lib-name">${escapeHtml(t.name)}</td>
            <td class="lib-artist"><span class="artist-link" onclick="event.stopPropagation();showArtist('${t.artist.replace(/'/g,"\\'")}')"> ${escapeHtml(t.artist)}</span></td>
            <td class="lib-del"><button class="add-btn" onclick="event.stopPropagation();addAndPlay('${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}','${t.videoId}')" title="Add to Library"><i class="fas fa-plus"></i></button></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    attachRowObserver(grid);
  } catch(e) { showToast("❌ Failed to load artist", true); }
}

async function loadTrending() {
  const grid = document.getElementById("trendingGrid");
  if (_trendingCache && Date.now() - _trendingCacheTime < TRENDING_TTL) { renderTrendingData(grid, _trendingCache); return; }
  grid.innerHTML = `
    <table class="library-table">
      <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
      <tbody>${Array(8).fill(0).map(() => `
        <tr class="lib-row">
          <td class="lib-thumb"><div class="skel skel-thumb"></div></td>
          <td class="lib-name"><div class="skel skel-title"></div></td>
          <td class="lib-artist"><div class="skel skel-artist"></div></td>
          <td></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  try {
    const res = await fetch(`${API}/trending`);
    _trendingCache = await res.json();
    _trendingCacheTime = Date.now();
    renderTrendingData(grid, _trendingCache);
  } catch (e) { showToast("❌ Failed to load trending", true); }
}

function renderTrendingData(grid, tracks) {
  grid.innerHTML = `
    <table class="library-table">
      <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
      <tbody>${tracks.map((t) => `
        <tr class="lib-row" onclick="streamDirect('${t.videoId}','${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}')">
          <td class="lib-thumb"><img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://i.ytimg.com/vi/default/mqdefault.jpg'" /></td>
          <td class="lib-name">${escapeHtml(t.name)}</td>
          <td class="lib-artist"><span class="artist-link" onclick="event.stopPropagation();showArtist('${t.artist.replace(/'/g,"\\'")}')"> ${escapeHtml(t.artist)}</span></td>
          <td class="lib-del"><button class="add-btn" onclick="event.stopPropagation();addAndPlay('${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}','${t.videoId}')" title="Add to Library"><i class="fas fa-plus"></i></button></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  attachRowObserver(grid);
}

function streamDirect(videoId, name, artist, thumb) {
  currentTrackId = videoId;
  document.getElementById("nowPlaying").innerText = name;
  document.getElementById("nowArtist").innerText = artist;
  document.getElementById("pImg").innerHTML = `<img src="${thumb}" alt="${name}" onerror="this.src='https://via.placeholder.com/60?text=No+Image'" />`;
  audio.src = `${API}/stream_direct/${videoId}`;
  audio.load();
  audio.oncanplay = () => {
    audio.oncanplay = null;
    audio.play().catch(() => showToast("❌ Playback failed", true));
  };
  updateModalContent(name, artist, thumb);
  showToast(`🎵 Now playing: ${name}`);
}

let _favIds = new Set();

async function loadFavouriteIds() {
  try {
    const res = await fetch(`${API}/favourites`);
    const favs = await res.json();
    _favIds = new Set(favs.map(f => f.id));
  } catch(e) {}
}

async function toggleFavourite(id, event) {
  event.stopPropagation();
  const track = library.find(t => t.id === id);
  if (!track) return;
  if (_favIds.has(id)) {
    await fetch(`${API}/favourites/${id}`, { method: "DELETE" });
    _favIds.delete(id);
    showToast(`💔 Removed from Favourites`);
  } else {
    await fetch(`${API}/favourites`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(track) });
    _favIds.add(id);
    showToast(`❤️ Added to Favourites`);
  }
  renderGrid(library);
  if (document.getElementById("section-favourites").style.display === "block") renderFavourites();
}

async function renderFavourites() {
  const grid = document.getElementById("favouritesGrid");
  try {
    const res = await fetch(`${API}/favourites`);
    const favs = await res.json();
    _favIds = new Set(favs.map(f => f.id));
    if (favs.length === 0) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-heart"></i><h3>No Favourites Yet</h3><p>Click the heart icon on any song</p></div>`;
      return;
    }
    grid.innerHTML = `
      <table class="library-table">
        <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
        <tbody>${favs.map(t => `
          <tr class="lib-row" onclick="playTrack('${t.id}','${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}')">
            <td class="lib-thumb"><img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://i.ytimg.com/vi/default/mqdefault.jpg'" /></td>
            <td class="lib-name">${escapeHtml(t.name)}</td>
            <td class="lib-artist"><span class="artist-link" onclick="event.stopPropagation();showArtist('${t.artist.replace(/'/g,"\\'")}')"> ${escapeHtml(t.artist)}</span></td>
            <td class="lib-del"><button class="fav-btn active" onclick="toggleFavourite('${t.id}',event)" title="Remove"><i class="fas fa-heart"></i></button></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    attachRowObserver(grid);
  } catch(e) { showToast("❌ Failed to load favourites", true); }
}

let _activeMenuId = null;

function toggleMenu(id, name, event) {
  event.stopPropagation();
  const menu = document.getElementById("globalMenu");
  if (_activeMenuId === id) { closeAllMenus(); return; }
  closeAllMenus();
  _activeMenuId = id;
  const playlists = _playlists;
  menu.innerHTML = `
    <div onclick="event.stopPropagation();createAndAddPlaylist('${id}',event)"><i class='fas fa-plus'></i> Create Playlist</div>
    ${playlists.length ? `<div class="menu-divider"></div>${playlists.map(p => `<div onclick="event.stopPropagation();addSongToPlaylist('${id}','${p.id}',event)"><i class='fas fa-list'></i> Add to ${escapeHtml(p.name)}</div>`).join('')}` : ''}
    <div class="menu-divider"></div>
    <div class="menu-danger" onclick="event.stopPropagation();deleteSong('${id}',event)"><i class='fas fa-trash-alt'></i> Delete</div>`;
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${rect.right - 190}px`;
  menu.classList.add("open");
}

function closeAllMenus() {
  _activeMenuId = null;
  const menu = document.getElementById("globalMenu");
  if (menu) menu.classList.remove("open");
  const sub = document.getElementById("globalSubmenu");
  if (sub) sub.classList.remove("open");
}

async function addSongToPlaylist(trackId, plId, event) {
  event.stopPropagation();
  closeAllMenus();
  const track = library.find(t => t.id === trackId);
  if (!track) return;
  const pl = _playlists.find(p => p.id === plId);
  if (pl && pl.songs.find(s => s.id === trackId)) { showToast("Already in playlist", true); return; }
  await fetch(`${API}/playlists/${plId}/songs`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(track) });
  await loadPlaylists();
  showToast(`✅ Added to "${pl?.name || 'playlist'}"`);
}

let _submenuTimer = null;

function showSubmenu(trackId, event) {
  clearTimeout(_submenuTimer);
  const playlists = _playlists;
  let sub = document.getElementById("globalSubmenu");
  if (!sub) {
    sub = document.createElement("div");
    sub.id = "globalSubmenu";
    sub.className = "three-dot-menu";
    document.body.appendChild(sub);
  }
  sub.innerHTML = playlists.map(p => `
    <div onclick="event.stopPropagation();addSongToPlaylist('${trackId}','${p.id}',event)">
      <i class='fas fa-list'></i> ${escapeHtml(p.name)}
    </div>`).join("");
  const item = event.currentTarget;
  const rect = item.getBoundingClientRect();
  sub.style.top = `${rect.top}px`;
  sub.style.left = `${rect.right + 4}px`;
  sub.classList.add("open");
  sub.onmouseenter = () => clearTimeout(_submenuTimer);
  sub.onmouseleave = () => hideSubmenuDelayed();
}

function hideSubmenuDelayed() {
  _submenuTimer = setTimeout(() => {
    const sub = document.getElementById("globalSubmenu");
    if (sub) sub.classList.remove("open");
  }, 200);
}

async function createAndAddPlaylist(trackId, event) {
  event.stopPropagation();
  closeAllMenus();
  const name = prompt("New playlist name:");
  if (!name || !name.trim()) return;
  const res = await fetch(`${API}/playlists`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: name.trim() }) });
  const { id: pid } = await res.json();
  const track = library.find(t => t.id === trackId);
  if (track) await fetch(`${API}/playlists/${pid}/songs`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(track) });
  await loadPlaylists();
  showToast(`✅ Created "${name.trim()}" and added song`);
}

// ============ PLAYLISTS ============
let _playlists = [];

async function loadPlaylists() {
  try {
    const res = await fetch(`${API}/playlists`);
    _playlists = await res.json();
  } catch(e) {}
}

async function createPlaylist() {
  const name = prompt("Playlist name:");
  if (!name || !name.trim()) return;
  await fetch(`${API}/playlists`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: name.trim() }) });
  await loadPlaylists();
  renderPlaylists();
}

async function deletePlaylist(id, event) {
  event.stopPropagation();
  if (!confirm("Delete this playlist?")) return;
  await fetch(`${API}/playlists/${id}`, { method: "DELETE" });
  await loadPlaylists();
  renderPlaylists();
}

function renderPlaylists() {
  const grid = document.getElementById("playlistsGrid");
  const pls = _playlists;
  grid.innerHTML = `
    <div class="artist-header">
      <h2 class="artist-title">Playlists</h2>
      <button class="back-btn" onclick="createPlaylist()"><i class="fas fa-plus"></i> New Playlist</button>
    </div>
    ${pls.length === 0 ? `<div class="empty-state"><i class="fas fa-list"></i><h3>No Playlists Yet</h3><p>Click "New Playlist" to create one</p></div>` : `
    <table class="library-table">
      <thead><tr><th>Name</th><th>Songs</th><th></th></tr></thead>
      <tbody>${pls.map(p => `
        <tr class="lib-row visible" onclick="openPlaylist('${p.id}')">
          <td class="lib-name" style="padding:14px"><i class="fas fa-list" style="margin-right:10px;color:var(--accent)"></i>${escapeHtml(p.name)}</td>
          <td class="lib-artist" style="padding:14px">${p.songs.length} songs</td>
          <td class="lib-del"><button class="del-btn" onclick="deletePlaylist('${p.id}',event)" title="Delete"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`).join("")}
      </tbody>
    </table>`}`;
}

function openPlaylist(id) {
  const pl = _playlists.find(p => p.id === id);
  if (!pl) return;
  showSection("playlist-detail");
  const grid = document.getElementById("playlistDetailGrid");
  grid.innerHTML = `
    <div class="artist-header">
      <button class="back-btn" onclick="showSection('playlists')"><i class="fas fa-arrow-left"></i> Back</button>
      <h2 class="artist-title">${escapeHtml(pl.name)}</h2>
    </div>
    ${pl.songs.length === 0 ? `<div class="empty-state"><i class="fas fa-music"></i><h3>No songs yet</h3><p>Add songs from Library</p></div>` : `
    <table class="library-table">
      <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
      <tbody>${pl.songs.map(t => `
        <tr class="lib-row" onclick="playTrack('${t.id}','${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}')">
          <td class="lib-thumb"><img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://i.ytimg.com/vi/default/mqdefault.jpg'" /></td>
          <td class="lib-name">${escapeHtml(t.name)}</td>
          <td class="lib-artist">${escapeHtml(t.artist)}</td>
          <td class="lib-del"><button class="del-btn" onclick="removeFromPlaylist('${id}','${t.id}',event)" title="Remove"><i class="fas fa-trash-alt"></i></button></td>
        </tr>`).join("")}
      </tbody>
    </table>`}`;
  attachRowObserver(grid);
}

async function removeFromPlaylist(plId, trackId, event) {
  event.stopPropagation();
  await fetch(`${API}/playlists/${plId}/songs/${trackId}`, { method: "DELETE" });
  await loadPlaylists();
  openPlaylist(plId);
  showToast("✅ Removed from playlist");
}

function renderSkeleton(count = 8) {
  const grid = document.getElementById("mainGrid");
  grid.innerHTML = `
    <table class="library-table">
      <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
      <tbody>${Array(count).fill(0).map(() => `
        <tr class="lib-row visible">
          <td class="lib-thumb"><div class="skel skel-thumb"></div></td>
          <td class="lib-name"><div class="skel skel-title"></div></td>
          <td class="lib-artist"><div class="skel skel-artist"></div></td>
          <td></td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

async function fetchLibrary() {
  try {
    const cached = localStorage.getItem("library_cache");
    if (cached && !library.length) {
      library = JSON.parse(cached);
      renderGrid(library);
    }
    renderSkeleton(library.length || 8);
    const res = await fetch(`${API}/library`);
    const fresh = await res.json();
    localStorage.setItem("library_cache", JSON.stringify(fresh));
    library = fresh;
    renderGrid(library);
  } catch (e) {
    if (library.length) renderGrid(library);
    else showToast("Failed to load library", true);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderGrid(lib) {
  const grid = document.getElementById("mainGrid");
  if (lib.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-music"></i><h3>Your Library is Empty</h3><p>Search for songs above</p></div>`;
    return;
  }
  grid.innerHTML = `
    <table class="library-table">
      <thead><tr><th></th><th>Title</th><th>Artist</th><th></th></tr></thead>
      <tbody>${lib.map((t) => `
        <tr class="lib-row" onclick="playTrack('${t.id}','${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}')">
          <td class="lib-thumb"><img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://i.ytimg.com/vi/default/mqdefault.jpg'" /></td>
          <td class="lib-name">${escapeHtml(t.name)}</td>
          <td class="lib-artist"><span class="artist-link" onclick="event.stopPropagation();showArtist('${t.artist.replace(/'/g,"\\'")}')"> ${escapeHtml(t.artist)}</span></td>
          <td class="lib-del">
            <button class="fav-btn ${_favIds.has(t.id) ? 'active' : ''}" onclick="toggleFavourite('${t.id}',event)" title="Favourite"><i class="fas fa-heart"></i></button>
            <button class="three-dot-btn" onclick="toggleMenu('${t.id}','${t.name.replace(/'/g,"\\'")}',event)" title="More"><i class="fas fa-ellipsis-v"></i></button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  attachRowObserver(grid);
}

function attachRowObserver(container) {
  const rows = container.querySelectorAll(".lib-row");
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add("visible");
      else e.target.classList.remove("visible");
    });
  }, { threshold: 0.1 });
  rows.forEach(r => observer.observe(r));
}

async function addAndPlay(name, artist, thumb, videoId) {
  if (isLoading) return;
  isLoading = true;
  dropdown.style.display = "none";
  dropdown.innerHTML = "";
  searchInput.value = "";
  searchInput.blur();
  showToast(`📥 Adding ${name}...`);
  try {
    const res = await fetch(`${API}/add_yt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, artist, thumbnail: thumb, videoId }),
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.ok) {
      library.push(data.track);
      renderGrid(library);
      playTrack(data.track.id, data.track.name, data.track.artist, data.track.thumbnail);
      showToast(`✅ ${data.track.name} is ready!`);
      setTimeout(() => {
        const rows = document.querySelectorAll(".lib-row");
        if (rows.length) rows[rows.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  } catch (e) {
    showToast("❌ Failed to add song", true);
  } finally {
    isLoading = false;
  }
}

function playTrack(id, name, artist, thumb) {
  currentTrackId = id;
  document.getElementById("nowPlaying").innerText = name;
  document.getElementById("nowArtist").innerText = artist;
  document.getElementById("pImg").innerHTML = `<img src="${thumb}" alt="${name}" onerror="this.src='https://via.placeholder.com/60?text=No+Image'" />`;
  audio.src = `${API}/stream/${id}`;
  audio.load();
  audio.oncanplay = () => {
    audio.oncanplay = null;
    audio.play().catch(() => {
      showToast("❌ Playback failed. Retrying...", true);
      setTimeout(() => audio.play().catch(() => showToast("❌ Cannot play this track", true)), 2000);
    });
  };
  updateModalContent(name, artist, thumb);
  showToast(`🎵 Now playing: ${name}`);
}

function syncPlayIcons() {
  const icon = audio.paused ? "fas fa-play" : "fas fa-pause";
  document.getElementById("playIcon").className = icon;
  document.getElementById("modalPlayIcon").className = icon;
}

function togglePlay() {
  if (!currentTrackId) { showToast("⚠️ No track selected", true); return; }
  if (audio.paused) {
    audio.play().catch(() => showToast("❌ Cannot play", true));
  } else {
    audio.pause();
  }
  syncPlayIcons();
}

function nextTrack() {
  if (!currentTrackId || !library.length) { showToast("⚠️ No tracks in library", true); return; }
  const idx = library.findIndex((t) => t.id === currentTrackId);
  const next = library[(idx + 1) % library.length];
  playTrack(next.id, next.name, next.artist, next.thumbnail);
}

function prevTrack() {
  if (!currentTrackId || !library.length) { showToast("⚠️ No tracks in library", true); return; }
  const idx = library.findIndex((t) => t.id === currentTrackId);
  const prev = library[(idx - 1 + library.length) % library.length];
  playTrack(prev.id, prev.name, prev.artist, prev.thumbnail);
}

function openPlayCard() {
  if (!currentTrackId) { showToast("⚠️ No track playing", true); return; }
  document.getElementById("playCardOverlay").style.display = "flex";
  const vol = audio.muted ? 0 : audio.volume;
  _syncVolFill(vol);
  const pcSlider = document.getElementById('pcVolSlider');
  if (pcSlider) pcSlider.value = Math.round(vol * 100);
}

function closePlayCard() {
  document.getElementById("playCardOverlay").style.display = "none";
}

function updateModalContent(n, a, t) {
  document.getElementById("modalTitle").innerText = n;
  document.getElementById("modalArtist").innerText = a;
  const cover = document.getElementById("modalCoverBg");
  const card = document.querySelector(".playcard-content");
  const hdThumb = t.replace(/\/hqdefault\.jpg.*$/, "/maxresdefault.jpg")
                   .replace(/\/mqdefault\.jpg.*$/, "/maxresdefault.jpg")
                   .replace(/=w\d+-h\d+.*$/, "=w600-h600-l90-rj");
  cover.classList.remove("fade-in");
  cover.classList.add("fade-out");
  const img = new Image();
  img.crossOrigin = "anonymous";
  const swap = (src) => {
    cover.style.backgroundImage = `url('${src}')`;
    cover.classList.remove("fade-out");
    void cover.offsetWidth;
    cover.classList.add("fade-in");
    // extract dominant color and apply to card background
    const ci = new Image();
    ci.crossOrigin = "anonymous";
    ci.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 10; canvas.height = 10;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(ci, 0, 0, 10, 10);
        const d = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
        const px = d.length / 4;
        r = Math.round(r / px * 0.4); // darken so text stays readable
        g = Math.round(g / px * 0.4);
        b = Math.round(b / px * 0.4);
        card.style.transition = "background 0.6s ease";
        card.style.background = `linear-gradient(135deg, rgb(${r},${g},${b}) 0%, #12343b 100%)`;
      } catch(e) {
        card.style.background = "#12343b";
      }
    };
    ci.onerror = () => { card.style.background = "#12343b"; };
    ci.src = src;
  };
  img.onload = () => swap(hdThumb);
  img.onerror = () => swap(t);
  img.src = hdThumb;
}

function seek(e) {
  if (!audio.duration) return;
  const bar = e.currentTarget.querySelector('.pc-bar, .p-track') || e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
  audio.currentTime = ratio * audio.duration;
}

function _updateVolIcon(id, val) {
  const icon = val == 0 ? 'fa-volume-mute' : val < 0.5 ? 'fa-volume-down' : 'fa-volume-up';
  const el = document.getElementById(id);
  if (!el) return;
  // pcVolIcon is a <button> containing <i>, volIcon is a plain <i>
  const iconEl = el.tagName === 'BUTTON' ? el.querySelector('i') : el;
  if (iconEl) iconEl.className = `fas ${icon}`;
  el.classList.toggle('muted', val == 0);
}

function _syncVolFill(val) {
  const slider = document.getElementById('pcVolSlider');
  if (!slider) return;
  const pct = Math.round(val * 100);
  slider.style.background = `linear-gradient(to right, #ff8928 0%, #ff414e ${pct}%, rgba(255,255,255,0.15) ${pct}%, rgba(255,255,255,0.15) 100%)`;
}

function setVolume(val) {
  audio.volume = parseFloat(val);
  audio.muted = false;
  _updateVolIcon('volIcon', val);
  _updateVolIcon('pcVolIcon', val);
  _syncVolFill(val);
  const pcSlider = document.getElementById('pcVolSlider');
  if (pcSlider) pcSlider.value = Math.round(val * 100);
}

function toggleMute() {
  const slider = document.getElementById('volSlider');
  const pcSlider = document.getElementById('pcVolSlider');
  if (!audio.muted) {
    _prevVol = audio.volume;
    audio.muted = true;
    if (slider) slider.value = 0;
    if (pcSlider) pcSlider.value = 0;
    _updateVolIcon('volIcon', 0);
    _updateVolIcon('pcVolIcon', 0);
    _syncVolFill(0);
  } else {
    audio.muted = false;
    if (slider) slider.value = _prevVol;
    if (pcSlider) pcSlider.value = Math.round(_prevVol * 100);
    _updateVolIcon('volIcon', _prevVol);
    _updateVolIcon('pcVolIcon', _prevVol);
    _syncVolFill(_prevVol);
  }
}

// ── Loop / Shuffle ───────────────────────────────────────
// loopMode: 0 = off, 1 = loop one, 2 = loop all
let loopMode = 0;
let shuffleOn = false;

function toggleLoop() {
  loopMode = (loopMode + 1) % 3;
  const labels = ['Loop Off', 'Loop One', 'Loop All'];
  const toasts = ['Loop Off', 'Loop One 🔂', 'Loop All 🔁'];
  const btn = document.getElementById('btnLoop');
  if (btn) {
    btn.classList.toggle('active', loopMode > 0);
    btn.title = labels[loopMode];
    btn.innerHTML = loopMode === 1
      ? '<i class="fas fa-redo"></i><span class="loop-badge">1</span>'
      : loopMode === 2
        ? '<i class="fas fa-redo"></i><span class="loop-badge">∞</span>'
        : '<i class="fas fa-redo"></i>';
  }
  showToast(toasts[loopMode]);
}

function toggleShuffle() {
  shuffleOn = !shuffleOn;
  document.getElementById('btnShuffle').classList.toggle('active', shuffleOn);
  showToast(shuffleOn ? 'Shuffle On' : 'Shuffle Off');
}

function setPcVolume(val) {
  // val is 0-100 from the slider
  const v = parseFloat(val) / 100;
  audio.volume = v;
  audio.muted = false;
  _updateVolIcon('pcVolIcon', v);
  _updateVolIcon('volIcon', v);
  const slider = document.getElementById('volSlider');
  if (slider) slider.value = v;
  _syncVolFill(v);
}

function togglePcMute() {
  toggleMute();
}

audio.onended = () => {
  if (loopMode === 1) {
    audio.currentTime = 0;
    audio.play();
  } else if (shuffleOn) {
    const idx = Math.floor(Math.random() * library.length);
    const t = library[idx];
    playTrack(t.id, t.name, t.artist, t.thumbnail);
  } else if (loopMode === 2) {
    nextTrack();
  } else {
    nextTrack();
  }
};
audio.onplay = () => syncPlayIcons();
audio.onpause = () => syncPlayIcons();

audio.ontimeupdate = () => {
  if (!audio.duration) return;
  const prog = (audio.currentTime / audio.duration) * 100 + "%";
  const fmt = (s) => Math.floor(s / 60) + ":" + Math.floor(s % 60).toString().padStart(2, "0");
  document.getElementById("fill").style.width = prog;
  document.getElementById("modalFill").style.width = prog;
  document.getElementById("currentTime").innerText = fmt(audio.currentTime);
  document.getElementById("durationTime").innerText = fmt(audio.duration);
  document.getElementById("modalCurrent").innerText = fmt(audio.currentTime);
  document.getElementById("modalDuration").innerText = fmt(audio.duration);
};

audio.onerror = (e) => {
  const err = audio.error;
  console.error("Audio error:", err?.code, err?.message);
  showToast(`❌ Playback error: ${err?.message || "unknown"}`, true);
};

searchInput.oninput = () => {
  const q = searchInput.value.trim();
  if (q.length < 2) { dropdown.style.display = "none"; return; }
  clearTimeout(window.searchTimer);
  window.searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${API}/search_yt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const tracks = await res.json();
      dropdown.innerHTML = tracks.map((t) => `
        <div class="search-item" onclick="addAndPlay('${t.name.replace(/'/g,"\\'")}','${t.artist.replace(/'/g,"\\'")}','${t.thumbnail}','${t.videoId}')">
          <img src="${t.thumbnail}" alt="${t.name}" onerror="this.src='https://via.placeholder.com/50?text=No+Image'" />
          <div><b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.artist)}</small></div>
        </div>`).join("");
      dropdown.style.display = tracks.length ? "block" : "none";
    } catch (e) {
      showToast("❌ Search failed", true);
    }
  }, 400);
};

async function deleteSong(id, event) {
  event.stopPropagation();
  closeAllMenus();
  if (!confirm("🗑️ Delete this song?")) return;
  try {
    const res = await fetch(`${API}/delete/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    await fetchLibrary();
    renderGrid(library);
    if (currentTrackId === id) {
      currentTrackId = null;
      audio.src = "";
      syncPlayIcons();
    }
    showToast("✅ Song deleted");
  } catch (e) {
    showToast("❌ Failed to delete", true);
  }
}

document.addEventListener("click", (e) => {
  if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = "none";
  }
  if (!e.target.closest(".three-dot-wrap")) closeAllMenus();
});

// set initial volume fill
_syncVolFill(1);

init();
