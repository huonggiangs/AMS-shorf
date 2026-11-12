import { ACTIONS, MODULES, type Action, type Module, type Permissions } from '../api/schemas';
import { ACTION_LABEL, MODULE_LABEL, isLocked } from '../lib/rbac';
import { useT } from '../i18n';

/** 12 modules x 4 actions. External roles are locked out of non-ad modules and approve/delete. */
export function PermissionMatrix({ role, value, onChange, readOnly = false }: { role: string; value: Permissions; onChange: (p: Permissions) => void; readOnly?: boolean }) {
  const t = useT();
  const toggle = (m: Module, a: Action) => {
    const cur = value[m] ?? [];
    const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a];
    onChange({ ...value, [m]: next });
  };
  return (
    <div className="tw">
      <table aria-label="Phân quyền chi tiết">
        <thead>
          <tr>
            <th>Mô-đun</th>
            {ACTIONS.map((a) => <th key={a} style={{ textAlign: 'center' }}>{t(ACTION_LABEL[a])}</th>)}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m}>
              <td>{t(MODULE_LABEL[m])}</td>
              {ACTIONS.map((a) => {
                const locked = isLocked(role, m, a);
                const on = !!value[m]?.includes(a) && !locked;
                return (
                  <td key={a} style={{ textAlign: 'center' }}>
                    <input type="checkbox" data-testid={`perm-${m}-${a}`} checked={on} disabled={locked || readOnly} onChange={() => toggle(m, a)} aria-label={`${MODULE_LABEL[m]} ${ACTION_LABEL[a]}`} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
