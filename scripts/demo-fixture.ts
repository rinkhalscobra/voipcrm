import { randomUUID } from "node:crypto";
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function buildDemoFixture() {
  const statements: string[] = [];
  const providers = [
    "Europe · Primary",
    "Europe · Secondary",
    "International · Reserve",
  ].map((name, i) => ({
    id: randomUUID(),
    name,
    balance: [4872.34, 735.8, 6914.62][i],
  }));
  const names = [
    "Atlas Connect",
    "Northstar Sales",
    "Meridian Group",
    "Echo Customer Care",
    "Nexa Solutions",
    "Pinnacle Outreach",
  ];
  const firstNames = [
    "Emma",
    "Lucas",
    "Sofia",
    "Oliver",
    "Mia",
    "Lena",
    "Matteo",
    "Amelia",
    "Felix",
    "Isabella",
    "Theo",
    "Clara",
  ];
  const lastNames = ["Hartmann", "Rossi", "Brooks", "Weber", "Marin", "Clarke"];
  const companies = names.map((name, index) => ({
    id: randomUUID(),
    name,
    index,
  }));
  const countries = [
    "Germany",
    "United Kingdom",
    "Italy",
    "France",
    "Netherlands",
    "Spain",
  ];
  const numberPrefixes = [
    "493055501",
    "442079460",
    "390255501",
    "331845550",
    "312055501",
    "349155501",
  ];
  statements.push(
    "insert into public.system_settings(key,value) values('data_mode','\"demo\"'::jsonb) on conflict(key) do update set value=excluded.value,updated_at=now();",
  );
  statements.push(
    `select set_config('request.jwt.claims','{"role":"service_role","aal":"aal2"}',true);`,
  );
  for (const provider of providers)
    statements.push(
      `insert into public.provider_accounts(id,name,currency,status,balance,credit,credit_limit,is_seed) values('${provider.id}',${quote(provider.name)},'EUR','disabled',${provider.balance},${provider.balance},0,true);`,
    );
  const allocations: {
    id: string;
    company: string;
    provider: string;
    did: string;
    user: string;
    manager: string;
    leader: string;
    version: string;
  }[] = [];
  for (const company of companies) {
    const { id, index } = company;
    const slug = `demo-${company.name.toLowerCase().replaceAll(" ", "-")}`;
    statements.push(
      `insert into public.companies(id,name,slug,contact_name,contact_email,country,currency,status,billing_mode,allowed_country_prefixes,billing_address,is_seed,created_at) values('${id}',${quote(company.name)},${quote(slug)},'Demo account contact',${quote(`${slug}@example.invalid`)},${quote(countries[index])},'EUR',${quote(index === 5 ? "trial" : "active")},${quote(index % 2 === 0 ? "prepaid" : "invoiced")},array['49','44','39','33','31','34'],'{"source":"Synthetic demo address"}',true,now()-interval '${180 - index * 17} days');`,
    );
    statements.push(
      `insert into public.customer_wallets(company_id,currency,minimum_balance) values('${id}','EUR',${index === 0 ? 200 : 100});`,
    );
    const department = randomUUID(),
      support = randomUUID(),
      team = randomUUID(),
      supportTeam = randomUUID();
    statements.push(
      `insert into public.company_departments(id,company_id,name) values('${department}','${id}','Sales'),('${support}','${id}','Customer success');`,
    );
    statements.push(
      `insert into public.teams(id,company_id,department_id,name) values('${team}','${id}','${department}','Outbound team'),('${supportTeam}','${id}','${support}','Customer care');`,
    );
    const members = [
      "company_admin",
      "manager",
      "team_leader",
      "agent",
      "agent",
    ].map((role, j) => ({
      id: randomUUID(),
      role,
      name: `${firstNames[(index * 3 + j) % firstNames.length]} ${lastNames[(index + j) % lastNames.length]}`,
      index: j,
    }));
    const manager = members[1].id,
      leader = members[2].id;
    for (const member of members) {
      statements.push(
        `insert into auth.users(id,email,raw_user_meta_data) values('${member.id}',${quote(`demo-${index + 1}-${member.role}-${member.index}@example.invalid`)},jsonb_build_object('full_name',${quote(member.name)},'demo',true));`,
      );
      statements.push(
        `update public.profiles set is_seed=true,suspended=true,local_status=${quote(["available", "available", "meeting", "available", "break"][(index + member.index) % 5])} where id='${member.id}';`,
      );
      statements.push(
        `insert into public.company_memberships(company_id,user_id,role,department_id,team_id,manager_id,team_leader_id) values('${id}','${member.id}',${quote(member.role)},'${department}','${team}',${member.index >= 2 ? quote(manager) : "null"},${member.index >= 3 ? quote(leader) : "null"});`,
      );
      statements.push(
        `insert into public.team_memberships(company_id,team_id,user_id,valid_from) values('${id}','${team}','${member.id}',now()-interval '120 days');`,
      );
    }
    statements.push(
      `update public.company_departments set manager_id='${manager}' where company_id='${id}'; update public.teams set leader_id='${leader}' where company_id='${id}';`,
    );
    const plan = randomUUID(),
      version = randomUUID();
    statements.push(
      `insert into public.pricing_plans(id,company_id,name,currency) values('${plan}','${id}',${quote(index % 2 === 0 ? "Business Connect" : "Contact Center Plus")},'EUR');insert into public.pricing_plan_versions(id,plan_id,version,valid_from,rules) values('${version}','${plan}',1,now()-interval '180 days','{"synthetic":true,"minimum_seconds":30,"increment_seconds":30}');`,
    );
    for (const [prefix, rate] of [
      ["49", "0.029"],
      ["44", "0.025"],
      ["39", "0.035"],
      ["33", "0.028"],
      ["31", "0.022"],
      ["34", "0.030"],
    ])
      statements.push(
        `insert into public.destination_rates(version_id,prefix,per_minute,connection_fee,minimum_seconds,increment_seconds) values('${version}','${prefix}',${rate},0.01,30,30);`,
      );
    if (index % 2 === 0)
      statements.push(
        `select public.wallet_post((select id from public.customer_wallets where company_id='${id}'),${index === 0 ? 125 : 3200 + index * 800},'credit','demo-opening:${id}','Demo opening credit · synthetic funds');`,
      );
    for (let j = 0; j < 6; j++) {
      const did = randomUUID(),
        allocation = randomUUID(),
        provider = providers[(index + j) % 3],
        user = members[3 + (j % 2)].id;
      const number = `+${numberPrefixes[(index + j) % countries.length]}${String(index * 6 + j + 1).padStart(3, "0")}`;
      statements.push(
        `insert into public.did_numbers(id,provider_account_id,provider_resource_id,number,country,provider_status,wholesale_monthly,renewal_at,raw) values('${did}','${provider.id}',${quote(`demo-did-${index * 6 + j + 1}`)},${quote(number)},${quote(countries[(index + j) % countries.length])},'active',${(1.5 + j * 0.25).toFixed(2)},(current_date+interval '20 days')::text,'{"synthetic":true,"source":"demo fixture","no_provider_request":true}');`,
      );
      statements.push(
        `insert into public.did_allocations(id,did_id,company_id,user_id,manager_id,team_leader_id,monthly_price,valid_from) values('${allocation}','${did}','${id}','${user}','${manager}','${leader}',${(4.5 + j * 0.5).toFixed(2)},now()-interval '120 days');`,
      );
      statements.push(
        `insert into public.did_user_assignments(company_id,allocation_id,user_id,valid_from) values('${id}','${allocation}','${user}',now()-interval '120 days');`,
      );
      allocations.push({
        id: allocation,
        company: id,
        provider: provider.id,
        did,
        user,
        manager,
        leader,
        version,
      });
    }
    for (const provider of providers)
      for (const member of members.slice(3)) {
        const providerUser = randomUUID(),
          providerResource = String(
            100000 +
              index * 100 +
              member.index * 10 +
              providers.indexOf(provider),
          );
        statements.push(
          `insert into public.provider_users(id,provider_account_id,provider_resource_id,name,application_user_id,raw) values('${providerUser}','${provider.id}',${quote(providerResource)},${quote(member.name)},'${member.id}','{"synthetic":true,"no_provider_request":true}');`,
        );
        statements.push(
          `insert into public.provider_devices(provider_account_id,provider_resource_id,provider_user_resource_id,application_user_id,raw) values('${provider.id}',${quote(`demo-extension-${providerResource}`)},${quote(providerResource)},'${member.id}','{"synthetic":true,"is_online":false}');`,
        );
      }
  }
  statements.push(
    `create temporary table demo_sources(rn integer,allocation_id uuid,company_id uuid,provider_id uuid,did_id uuid,user_id uuid,manager_id uuid,leader_id uuid,version_id uuid);`,
  );
  statements.push(
    `insert into demo_sources values ${allocations.map((a, i) => `(${i + 1},'${a.id}','${a.company}','${a.provider}','${a.did}','${a.user}','${a.manager}','${a.leader}','${a.version}')`).join(",")};`,
  );
  statements.push(`create temporary table demo_calls as select gen_random_uuid() as id,g,s.*,n.number,
 case when g%20=0 then 'failed' when g%20=1 then 'busy' when g%20 in(2,3) then 'noanswer' else 'answer' end as status,
 case when g%20>=4 then 30+(g*37)%450 else 0 end as seconds,
 now()-make_interval(days=>((g-1)%30)::integer,hours=>((g*7)%20)::integer,mins=>((g*13)%60)::integer) as started_at,
 case g%6 when 0 then '+493055502' when 1 then '+442079461' when 2 then '+390255502' when 3 then '+331845551' when 4 then '+312055502' else '+349155502' end||lpad((g%900)::text,3,'0') as destination
 from generate_series(1,1800) g join demo_sources s on s.rn=((g-1)%36)+1 join public.did_numbers n on n.id=s.did_id;`);
  statements.push(`insert into public.calls(id,provider_account_id,provider_resource_id,company_id,user_id,manager_id,team_leader_id,allocation_id,origin,destination,started_at,ended_at,duration_seconds,direction,status,provider_cost,customer_charge,currency,billing_status)
 select c.id,c.provider_id,'demo-call-'||c.g,c.company_id,c.user_id,c.manager_id,c.leader_id,c.allocation_id,c.number,c.destination,c.started_at,c.started_at+make_interval(secs=>greatest(c.seconds,12)),c.seconds,case when c.g%5=0 then 'inbound' else 'outbound' end,c.status,round(c.seconds::numeric*0.009/60,6),case when c.status='answer' then round(0.01+ceil(greatest(c.seconds,30)::numeric/30)*30*r.per_minute/60,6) else 0 end,'EUR',case when c.status='answer' then 'charged' else 'not_billable' end
 from demo_calls c join public.destination_rates r on r.version_id=c.version_id and replace(c.destination,'+','') like r.prefix||'%';`);
  statements.push(
    `insert into private.call_payloads(call_id,raw) select id,jsonb_build_object('synthetic',true,'source','Demo dataset','no_provider_request',true) from demo_calls;`,
  );
  statements.push(`insert into public.call_charges(call_id,company_id,version_id,currency,amount,pricing_snapshot)
 select c.id,c.company_id,s.version_id,'EUR',c.customer_charge,to_jsonb(r)||'{"synthetic":true}'::jsonb from public.calls c join demo_sources s on s.allocation_id=c.allocation_id join public.destination_rates r on r.version_id=s.version_id and replace(c.destination,'+','') like r.prefix||'%' where c.is_seed and c.status='answer';`);
  statements.push(
    `do $$ declare charge record; begin for charge in select ch.*,w.id as wallet_id from public.call_charges ch join public.companies co on co.id=ch.company_id and co.billing_mode='prepaid' join public.customer_wallets w on w.company_id=ch.company_id and w.currency=ch.currency where ch.is_seed order by ch.created_at,ch.id loop perform public.wallet_post(charge.wallet_id,-charge.amount,'call_charge','demo-call:'||charge.call_id::text,'Demo calling usage · synthetic charge',charge.id); end loop; end $$;`,
  );
  for (const company of companies) {
    const invoice = randomUUID(),
      paid = company.index % 2 === 0 || company.index === 1;
    statements.push(
      `insert into public.invoices(id,company_id,number,currency,status,period_start,period_end,subtotal,tax,total,due_at,created_at) select '${invoice}','${company.id}',${quote(`DEMO-INV-${String(company.index + 1).padStart(4, "0")}`)},'EUR',${quote(paid ? "paid" : "issued")},current_date-30,current_date,coalesce(sum(amount),0),0,coalesce(sum(amount),0),current_date+${company.index === 3 ? -3 : 14},now()-interval '${company.index + 1} days' from public.call_charges where company_id='${company.id}';`,
    );
    statements.push(
      `insert into public.invoice_items(company_id,invoice_id,description,quantity,unit_price,tax_percent) select '${company.id}','${invoice}','Demo calling usage · synthetic invoice',1,total,0 from public.invoices where id='${invoice}';`,
    );
    if (paid || company.index === 5)
      statements.push(
        `insert into public.payments(company_id,invoice_id,amount,currency,reference) select '${company.id}','${invoice}',${paid ? "total" : "round(total/2,6)"},'EUR',${quote(`DEMO-${company.index % 2 === 0 ? "WALLET" : "BANK"}-RECEIPT-${company.index + 1}`)} from public.invoices where id='${invoice}';`,
      );
    statements.push(
      `insert into public.audit_logs(company_id,action,resource_id,metadata,created_at) values('${company.id}','demo.company_loaded','${company.id}','{"synthetic":true}',now()-interval '${company.index + 1} hours');`,
    );
  }
  statements.push(
    `insert into public.did_orders(company_id,status,country,quantity,raw) values('${companies[0].id}','draft','Germany',5,'{"synthetic":true,"no_provider_order":true}'),('${companies[2].id}','draft','United Kingdom',10,'{"synthetic":true,"no_provider_order":true}'),('${companies[4].id}','draft','Italy',3,'{"synthetic":true,"no_provider_order":true}');`,
  );
  statements.push(`insert into public.notifications(company_id,title,message,severity,created_at) values
 ('${companies[0].id}','Demo · Wallet threshold reminder','Sample low-balance alert. This wallet contains synthetic demo funds.','warning',now()-interval '40 minutes'),
 ('${companies[3].id}','Demo · Invoice awaiting payment','Sample overdue invoice for Meridian workflow exploration. No real payment is due.','warning',now()-interval '2 hours'),
 (null,'Demo workspace is ready','Three synthetic provider accounts, six companies, thirty employees, and 1,800 calls are available. External provider requests are disabled.','info',now()),
 (null,'Demo · Provider balance reminder','Sample reserve-balance alert for Europe Secondary. This balance is fictional.','info',now()-interval '3 hours');`);
  statements.push(
    `insert into public.notification_rules(provider_account_id,type,threshold) values('${providers[1].id}','provider_balance_low',1000);`,
  );
  statements.push(
    `insert into public.audit_logs(action,metadata) values('demo.dataset_loaded','{"synthetic":true,"providers":3,"companies":6,"employees":30,"numbers":36,"calls":1800}');`,
  );
  return {
    query: statements.join("\n"),
    companies: companies.map((c) => c.id),
    providers: providers.map((p) => p.id),
    callCount: 1800,
  };
}
