'use server';

import { z } from 'zod';

import { createUser, getUser } from '@/lib/db/queries';

import { signIn } from './auth';

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export interface LoginActionState {
  status: 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data';
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
      return { status: 'invalid_data' };
    }

    return { status: 'failed' };
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
}

export const register = async (
  _: RegisterActionState,
  formData: FormData,
): Promise<RegisterActionState> => {
  try {
    console.log('Registration attempt - Raw form data:', {
      email: formData.get('email'),
      password: formData.get('password')?.toString().length, // Log only length for security
    });

    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    console.log('Validation successful for email:', validatedData.email);

    const [user] = await getUser(validatedData.email);

    if (user) {
      console.log('User already exists with email:', validatedData.email);
      return { status: 'user_exists' } as RegisterActionState;
    }

    console.log('Creating new user with email:', validatedData.email);
    await createUser(validatedData.email, validatedData.password);
    
    console.log('User created successfully, attempting sign in');
    await signIn('credentials', {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    console.log('Sign in successful');
    return { status: 'success' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Zod validation error:', {
        errors: error.errors.map(err => ({
          path: err.path,
          message: err.message,
          code: err.code
        })),
        formData: {
          email: formData.get('email'),
          passwordLength: formData.get('password')?.toString().length
        }
      });
      return { status: 'invalid_data' };
    }

    console.error('Registration failed with error:', error instanceof Error ? error.message : error);
    return { status: 'failed' };
  }
};
