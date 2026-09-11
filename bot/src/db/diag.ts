import { sql } from 'drizzle-orm';
import { db, client } from './client.js';

async function main() {
  const t = (await db.execute(sql`
    select count(*)::int c, coalesce(sum(amount),0)::float eur, max(purchased_at) last from purchases`) as unknown as any[])[0];
  const st = (await db.execute(sql`select status, death_reason, count(*)::int c from phones group by status, death_reason order by status`)) as unknown as any[];
  const res = (await db.execute(sql`select result, count(*)::int c from purchases group by result`)) as unknown as any[];
  const oq = (await db.execute(sql`select status, count(*)::int c from order_queue group by status`)) as unknown as any[];
  const lnk = (await db.execute(sql`select count(*)::int c from purchases where order_queue_id is not null`)) as unknown as any[];

  console.log(`покупок: ${t.c} · €${Number(t.eur).toFixed(2)}`);
  console.log('телефоны: ' + st.map((r) => `${r.status}/${r.death_reason ?? '—'}=${r.c}`).join(' '));
  console.log('результаты: ' + res.map((r) => `${r.result}=${r.c}`).join(' '));
  console.log('заказы: ' + oq.map((r) => `${r.status}=${r.c}`).join(' '));
  console.log(`покупок, привязанных к заказам: ${lnk[0].c}`);
  await client.end();
}
main().catch((e) => { console.error('❌', e.message); process.exit(1); });
