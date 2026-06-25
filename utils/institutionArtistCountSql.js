const { ARTIST_PUBLIC_WHERE_UNALIASED } = require('./publicVisibilitySchema')

const INSTITUTION_ARTIST_COUNT_AGG_SUBQUERY = `
  LEFT JOIN (
    SELECT institution_id, COUNT(*) AS artist_count
    FROM artists
    WHERE ${ARTIST_PUBLIC_WHERE_UNALIASED}
      AND institution_id IS NOT NULL
    GROUP BY institution_id
  ) ac ON ac.institution_id = i.id
`

const INSTITUTION_ARTIST_COUNT_SELECT = 'COALESCE(ac.artist_count, 0) AS artist_count'

module.exports = {
  INSTITUTION_ARTIST_COUNT_AGG_SUBQUERY,
  INSTITUTION_ARTIST_COUNT_SELECT,
}
