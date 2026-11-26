const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const greens = [0, 28, 34, 40, 46];

export function printPreview(plan, repository = 'Offline preview') {
  const { days, seed, timezone, startDate, endDate, total, existingCount } = plan;
  const active = days.filter(day => day.count > 0).length;
  const within = days.reduce((sum, day) => sum + day.existing, 0);
  console.log('\nSYNTHETIC CONTRIBUTION PREVIEW');
  console.log(`Repository       ${repository}`);
  console.log(`Date range       ${startDate} through ${endDate} (${days.length} days)`);
  console.log(`Timezone         ${timezone}     Seed  ${seed}`);
  console.log(`Existing ledger  ${existingCount} entries (${within} in range)`);
  console.log(`New commits      ${total}     Active dates  ${active}     Inactive dates  ${days.length-active}`);

  const columns = Math.ceil((days[0].weekday + days.length)/7);
  const grid = weekdays.map(() => Array(columns).fill(' '));
  const busiest = Math.max(...days.map(day => day.count));
  const color = process.stdout.isTTY && !('NO_COLOR' in process.env) && process.stdout.hasColors?.(256);
  let longest = 0;
  let streak = 0;
  for (const day of days) {
    const week = Math.floor((days[0].weekday + day.index)/7);
    const level = day.count ? Math.ceil(day.count * 4 / busiest) : 0;
    const symbol = '.:oO#'[level];
    grid[day.weekday][week] = color && level ? `\x1b[38;5;${greens[level]}m${symbol}\x1b[0m` : symbol;
    streak = day.count ? streak + 1 : 0;
    longest = Math.max(streak,longest);
  }
  const width = Math.max(1, Math.min(53, (process.stdout.columns || 80)-7));
  for (let left=0; left<columns; left+=width) {
    const first = Math.max(0, left*7-days[0].weekday);
    const last = Math.min(days.length-1, (left+width)*7-days[0].weekday-1);
    console.log(`\n${days[first].date} through ${days[last].date}`);
    const ruler = Array(Math.min(width, columns-left)).fill(' ');
    let nextFree = 0;
    for (let index = first; index <= last; index++) {
      const day = days[index];
      if (index !== first && !day.date.endsWith('-01')) continue;
      const column = Math.floor((days[0].weekday + index)/7) - left;
      const month = months[Number(day.date.slice(5,7))-1];
      if (column >= nextFree && column + month.length <= ruler.length) {
        ruler.splice(column, month.length, ...month);
        nextFree = column + month.length + 1;
      }
    }
    if (nextFree) console.log('     ' + ruler.join('').trimEnd());
    weekdays.forEach((label,row) => console.log(`${label}  ${grid[row].slice(left,left+width).join('')}`));
  }
  console.log('\n. none    : low    o moderate    O high    # peak');
  console.log(`Cells show newly planned synthetic activity. Longest planned streak is ${longest} days.`);
}
