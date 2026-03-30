'use server';

import { AuthError } from 'next-auth';
import { z } from 'zod';

import { createUser, getUser } from '@/lib/db/queries';

import { signIn } from './auth';

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export interface LoginActionState {
  status: 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data';
  error?: string;
}

export const login = async (
  _: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    await signIn('credentials', {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: 'success' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data', error: 'Please provide a valid email and password.' };
    }

    if (error instanceof AuthError) {
      return { status: 'failed', error: 'Invalid email or password.' };
    }

    return { status: 'failed', error: 'Unable to sign in right now. Please try again.' };
  }
};

export interface RegisterActionState {
  status:
    | 'idle'
    | 'in_progress'
    | 'success'
    | 'failed'
    | 'user_exists'
    | 'invalid_data';
  error?: string;
}

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: 'user_exists', error: 'An account already exists for this email.' };
    }

    await createUser(validatedData.email, validatedData.password);

    await signIn('credentials', {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: 'success' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data', error: 'Please provide a valid email and password (minimum 6 characters).' };
    }

    if (error instanceof AuthError) {
      return { status: 'failed', error: 'Account created, but auto-login failed. Please sign in.' };
    }

    return { status: 'failed', error: 'Unable to create account right now. Please try again.' };
  }
};
