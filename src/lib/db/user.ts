/**
 * User model — identities for people who have signed in with Google.
 *
 * Kept in its own module (rather than in src/lib/db/models.ts) because the
 * auth layer wants to import User cleanly without dragging the full set of
 * domain models into edge/runtime paths. The model is still re-exported from
 * models.ts for compatibility with callers that expect everything there.
 *
 * Role bootstrap:
 *  - On first sign-in, if AUTH_ADMIN_EMAILS contains the user's email, the
 *    user is created with role='admin'. Otherwise role='user'. This is the
 *    only automatic way to mint an admin — there's no self-serve path.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'user' | 'admin';

export interface IUser extends Document {
  email: string;
  name: string;
  image: string;
  role: UserRole;
  googleSub: string; // stable Google user id ("sub" claim)
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    image: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    googleSub: { type: String, default: '', index: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User =
  (mongoose.models.User as mongoose.Model<IUser>) ||
  mongoose.model<IUser>('User', UserSchema);

/** Return the parsed AUTH_ADMIN_EMAILS allowlist (comma-separated, case-insensitive). */
export function adminAllowlist(): Set<string> {
  const raw = process.env.AUTH_ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Decide the role a newly-seen email should get. */
export function roleForEmail(email: string): UserRole {
  return adminAllowlist().has(email.toLowerCase()) ? 'admin' : 'user';
}
