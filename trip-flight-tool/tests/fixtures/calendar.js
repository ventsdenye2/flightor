const { initial, options } = window.calendarConfig;
const monthIndex = value => { const [year, month] = value.split('-').map(Number); return year * 12 + month - 1; };
let current = monthIndex(initial);
const calendar = document.getElementById('calendar');
function render() {
  calendar.replaceChildren();
  for (const direction of [-1, 1]) {
    const navigation = document.createElement('span');
    navigation.role = 'button'; navigation.tabIndex = 0;
    navigation.ariaLabel = `Go to ${direction === -1 ? 'previous' : 'next'} month`;
    navigation.textContent = direction === -1 ? 'Previous' : 'Next';
    navigation.ariaDisabled = String(direction === -1 ? current <= monthIndex(options.minimum ?? '2026-10') : current >= monthIndex(options.maximum ?? '2027-09'));
    navigation.onclick = () => {
      if (navigation.ariaDisabled === 'true') return;
      const key = direction === -1 ? 'previous' : 'next';
      document.body.dataset[key] = String(Number(document.body.dataset[key] ?? 0) + 1);
      setTimeout(() => { current += direction; render(); }, 25);
    };
    calendar.append(navigation);
  }
  for (const month of [current, current + 1]) {
    const first = new Date(Date.UTC(Math.floor(month / 12), month % 12, 1, 12));
    const grid = document.createElement('table'); grid.role = 'grid';
    grid.ariaLabel = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(first);
    for (let day = 1; day <= 31; day++) {
      const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day, 12));
      if (date.getUTCMonth() !== first.getUTCMonth()) break;
      const iso = date.toISOString().slice(0, 10);
      const cell = document.createElement('td'); cell.role = 'gridcell'; cell.ariaDisabled = String(options.disabledDate === iso);
      const checkbox = document.createElement('div'); checkbox.role = 'checkbox'; checkbox.ariaChecked = 'false'; checkbox.textContent = String(day);
      checkbox.ariaLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date) + ', Select the start date you want';
      checkbox.onclick = () => { document.querySelector('[data-testid=search_date_depart0]').setAttribute('data-date', iso); calendar.hidden = true; };
      cell.append(checkbox); grid.append(cell);
    }
    calendar.append(grid);
  }
}
document.querySelector('[role=group]').addEventListener('click', () => { calendar.hidden = false; render(); });
