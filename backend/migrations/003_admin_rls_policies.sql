-- Allow admin users to read all subscriptions
CREATE POLICY "Admins can view all subscriptions"
ON public.subscriptions FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Allow admin users to update any subscription plan
CREATE POLICY "Admins can update all subscriptions"
ON public.subscriptions FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Allow admin users to insert subscriptions for any user
CREATE POLICY "Admins can insert subscriptions"
ON public.subscriptions FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);
