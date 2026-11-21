import { useNow } from '../App';
import type { AppData } from '../lib/data';
import { countCards, forecast, retention, reviewsPerDay, reviewsToday, shiftDay, streak } from '../lib/stats';

const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** A plain bar chart. `dates[i]` is the day of `values[i]`; one bar may be marked as today. */
function Bars({ values, dates, today, unit, label }: { values: number[]; dates: number[]; today: number; unit: string; label: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure className="chart">
      <div className="bars" role="img" aria-label={`${label}: ${total} ${unit} in total, at most ${max === 1 && total === 0 ? 0 : max} on one day.`}>
        {values.map((v, i) => (
          <div key={i} className={`col ${i === today ? 'now' : ''}`} title={`${dayLabel(dates[i]!)}: ${v} ${unit}`}>
            <div className="fill" style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <figcaption className="muted">
        <span>{dayLabel(dates[0]!)}</span>
        <span>
          {total} {unit}, peak {total ? max : 0} a day
        </span>
        <span>{dayLabel(dates[dates.length - 1]!)}</span>
      </figcaption>
    </figure>
  );
}

const PAST = 30;
const AHEAD = 14;

export function Stats({ data }: { data: AppData }) {
  const now = useNow();
  const { cards, states, logs, settings } = data;
  const run = streak(logs, now);
  const kept = retention(logs, now, PAST);
  const counts = countCards(cards, states, now);
  const done = reviewsToday(logs, now);
  const share = (n: number) => `${counts.total ? (n / counts.total) * 100 : 0}%`;

  return (
    <>
      <h1>Stats</h1>
      <dl className="tiles">
        <div>
          <dt>Streak</dt>
          <dd>{run.current} {run.current === 1 ? 'day' : 'days'}</dd>
          <dd className="muted">Longest: {run.longest}</dd>
        </div>
        <div>
          <dt>Retention, last {PAST} days</dt>
          <dd>{kept.rate === null ? 'No data yet' : `${Math.round(kept.rate * 100)}%`}</dd>
          <dd className="muted">
            {kept.rate === null
              ? 'Counts cards that have left the learning steps.'
              : `${kept.recalled} of ${kept.reviews} reviews recalled. Target: ${Math.round(settings.retention * 100)}%`}
          </dd>
        </div>
        <div>
          <dt>Today</dt>
          <dd>{done} of {settings.dailyGoal}</dd>
          <dd className="muted">{done >= settings.dailyGoal ? 'Daily goal reached' : 'reviews toward the daily goal'}</dd>
        </div>
      </dl>

      <h2>Reviews, last {PAST} days</h2>
      <Bars
        label={`Reviews per day over the last ${PAST} days`}
        unit="reviews"
        values={reviewsPerDay(logs, now, PAST)}
        dates={Array.from({ length: PAST }, (_, i) => shiftDay(now, PAST - 1 - i))}
        today={PAST - 1}
      />

      <h2>Coming due, next {AHEAD} days</h2>
      <Bars
        label={`Cards coming due per day over the next ${AHEAD} days, overdue cards counted today`}
        unit="cards"
        values={forecast(cards, states, now, AHEAD)}
        dates={Array.from({ length: AHEAD }, (_, i) => shiftDay(now, -i))}
        today={0}
      />

      <h2>Cards</h2>
      <div className="stack" role="img" aria-label={`${counts.total} cards: ${counts.new} new, ${counts.learning} learning, ${counts.review} in review.`}>
        <span className="s-new" style={{ width: share(counts.new) }} />
        <span className="s-learning" style={{ width: share(counts.learning) }} />
        <span className="s-review" style={{ width: share(counts.review) }} />
      </div>
      <ul className="legend">
        <li><i className="s-new" /> {counts.new} new</li>
        <li><i className="s-learning" /> {counts.learning} learning</li>
        <li><i className="s-review" /> {counts.review} in review</li>
      </ul>
    </>
  );
}
