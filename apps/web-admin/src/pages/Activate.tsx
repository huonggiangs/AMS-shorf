import { AcceptInvite } from './Invite';

/** /activate?token= : lời mời người dùng nội bộ (mật khẩu + TOTP). */
export default function Activate() {
  return <AcceptInvite internal />;
}
