CREATE TABLE daily_counts (
  day TEXT NOT NULL CHECK(day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  event TEXT NOT NULL CHECK(event IN ('open', 'start', 'success')),
  count INTEGER NOT NULL CHECK(count >= 0),
  PRIMARY KEY(day, event)
) WITHOUT ROWID;
