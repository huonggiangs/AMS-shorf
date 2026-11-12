import { useState } from 'react';
import { NotConnected, PageHead, Tabs } from '../components/ui';

/** Reward wallet / tasks / settings of the TV app: no admin endpoint in PLAN §4 yet, so no numbers are shown. */
export default function TvExperience() {
  const [tab, setTab] = useState('rewards');
  return (
    <>
      <PageHead title="Trải nghiệm trên TV" sub="Nội dung hiển thị ở các màn hình Smart TV." />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'rewards', label: 'Ví thưởng' }, { id: 'tasks', label: 'Nhiệm vụ' }, { id: 'wallet', label: 'Ví & rút tiền' }, { id: 'settings', label: 'Cài đặt TV' }]} />
      <NotConnected what="Ví thưởng, nhiệm vụ, rút tiền và cài đặt TV (app TV thuộc phạm vi sau)" />
    </>
  );
}
