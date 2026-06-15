-- Add email and phone to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Update existing profiles from auth.users (if any exist)
UPDATE public.profiles p
SET email = u.email,
    phone = u.phone
FROM auth.users u
WHERE p.id = u.id;

-- Recreate trigger function to copy email and phone on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
    NEW.email,
    NEW.phone
  );
  RETURN NEW;
END;
$$;

-- Allow SELECT on profiles for all users to enable participant search when scheduling meetings
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_all"
  ON public.profiles FOR SELECT
  USING (true);
