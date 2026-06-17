/* ══════════════════════════════════════════
   PLAYRA — AVATAR DATA MODULE
   12 premium illustrated avatars for quiz participants
   ══════════════════════════════════════════ */

/**
 * All avatars available for participant selection.
 * Each avatar has a unique id, display label, category, and image path.
 */
export const AVATARS = [
  // ── Male ──
  { id: 'tech-student-m',      label: 'Tech Student',      category: 'male', src: '/avatars/tech-student-m.png' },
  { id: 'college-student-m',   label: 'College Student',   category: 'male', src: '/avatars/college-student-m.png' },
  { id: 'teacher-m',           label: 'Teacher',           category: 'male', src: '/avatars/teacher-m.png' },
  { id: 'professional-m',     label: 'Professional',      category: 'male', src: '/avatars/professional-m.png' },
  { id: 'founder-m',           label: 'Founder',           category: 'male', src: '/avatars/founder-m.png' },
  { id: 'research-student-m', label: 'Research Student',  category: 'male', src: '/avatars/research-student-m.png' },

  // ── Female ──
  { id: 'tech-student-f',      label: 'Tech Student',      category: 'female', src: '/avatars/tech-student-f.png' },
  { id: 'college-student-f',   label: 'College Student',   category: 'female', src: '/avatars/college-student-f.png' },
  { id: 'teacher-f',           label: 'Teacher',           category: 'female', src: '/avatars/teacher-f.png' },
  { id: 'professional-f',     label: 'Professional',      category: 'female', src: '/avatars/professional-f.png' },
  { id: 'founder-f',           label: 'Founder',           category: 'female', src: '/avatars/founder-f.png' },
  { id: 'research-student-f', label: 'Research Student',  category: 'female', src: '/avatars/research-student-f.png' },
];

/**
 * Look up an avatar object by its unique ID.
 * @param {string} id — Avatar ID (e.g. 'tech-student-m')
 * @returns {object|null}
 */
export function getAvatarById(id) {
  return AVATARS.find(a => a.id === id) || null;
}

/**
 * Return a random avatar from the collection.
 * Optionally exclude a specific id so "Random" doesn't re-pick the current one.
 * @param {string|null} excludeId
 * @returns {object}
 */
export function getRandomAvatar(excludeId = null) {
  const pool = excludeId ? AVATARS.filter(a => a.id !== excludeId) : AVATARS;
  return pool[Math.floor(Math.random() * pool.length)];
}
