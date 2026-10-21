-- =====================================================================
-- RUKN — "Why this service" content for patients and for clinicians.
-- Adds three translatable fields to services, updates publishing, and
-- fills the approved English/Arabic texts for the four services.
-- Safe to run more than once.
-- =====================================================================

alter table public.service_translations
  add column if not exists why_heading text check (char_length(why_heading) <= 160),
  add column if not exists why_patients jsonb not null default '[]'::jsonb check (jsonb_typeof(why_patients) = 'array'),
  add column if not exists why_clinicians jsonb not null default '[]'::jsonb check (jsonb_typeof(why_clinicians) = 'array');

create or replace function public.publish_service(p_id uuid)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if not public.can_manage_content() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  delete from public.service_translations where service_id = p_id and variant = 'published';
  insert into public.service_translations (service_id, locale, variant, title, nav_title, summary, description,
         features_heading, features, workflow_heading, workflow, notice, cta_label, price_note, seo_title, seo_description,
         why_heading, why_patients, why_clinicians, updated_by)
  select service_id, locale, 'published', title, nav_title, summary, description,
         features_heading, features, workflow_heading, workflow, notice, cta_label, price_note, seo_title, seo_description,
         why_heading, why_patients, why_clinicians, auth.uid()
  from public.service_translations where service_id = p_id and variant = 'draft';
  update public.services set status = 'published', published_at = now() where id = p_id;
end $$;
grant execute on function public.publish_service(uuid) to authenticated;
revoke execute on function public.publish_service(uuid) from anon;

-- Interface labels
insert into public.translations (namespace, key, locale, value) values
  ('ui', 'services.for_patients', 'en', 'For patients'),
  ('ui', 'services.for_patients', 'ar', 'للمرضى'),
  ('ui', 'services.for_clinicians', 'en', 'For dentists & orthodontists'),
  ('ui', 'services.for_clinicians', 'ar', 'لأطباء الأسنان وأخصائيي التقويم')
on conflict (namespace, key, locale) do nothing;

-- Helper: write the same content into the draft and published variants
create function pg_temp.set_why(p_slug text, p_locale text, p_heading text, p_patients jsonb, p_clinicians jsonb)
returns void language sql as $$
  update public.service_translations t
     set why_heading = p_heading, why_patients = p_patients, why_clinicians = p_clinicians
    from public.services s
   where s.id = t.service_id and s.slug = p_slug and t.locale = p_locale;
$$;

-- ---------------------------------------------------------------------
-- Digital Treatment Planning
-- ---------------------------------------------------------------------
select pg_temp.set_why('digital-treatment-planning', 'en', 'Why digital treatment planning?',
  '[{"icon":"transparency","title":"See the plan before you start","text":"A virtual treatment setup shows how your teeth are planned to move, so you can understand the treatment before it begins."},
    {"icon":"workflow","title":"Clear expectations at every stage","text":"The treatment is divided into stages that your dentist can explain in advance, so you know what each phase involves."},
    {"icon":"smile","title":"Built around your own teeth","text":"Every plan is prepared from your own dental records, not a generic template, and is reviewed by your treating dentist."},
    {"icon":"clinician","title":"Your dentist stays in charge","text":"Nothing is produced until your dentist has reviewed and approved the plan."}]',
  '[{"icon":"clinician","title":"Full clinical control","text":"Review the virtual setup and staging, request revisions, and approve only when the plan meets your clinical objectives."},
    {"icon":"digital","title":"Visual case presentation","text":"A clear visual setup supports treatment discussions and helps patients understand and accept the proposed plan."},
    {"icon":"planning","title":"Less back-and-forth","text":"Digital case review and coordinated revisions can reduce chair time and repeated communication before production."},
    {"icon":"team","title":"Planning support without an in-house team","text":"Access a multidisciplinary team of dentists, dental technicians, and engineers for selected clear aligner cases."}]');

select pg_temp.set_why('digital-treatment-planning', 'ar', 'لماذا التخطيط الرقمي للعلاج؟',
  '[{"icon":"transparency","title":"شاهد خطتك قبل أن تبدأ","text":"يُظهر الإعداد العلاجي الافتراضي كيف ستتحرك أسنانك وفق الخطة، فتفهم العلاج قبل البدء به."},
    {"icon":"workflow","title":"وضوح في كل مرحلة","text":"يُقسَّم العلاج إلى مراحل يشرحها لك طبيبك مسبقًا، فتعرف ما تتضمنه كل مرحلة."},
    {"icon":"smile","title":"خطة مبنية على أسنانك أنت","text":"تُعدّ كل خطة من سجلات أسنانك الخاصة وليس من نموذج عام، ويراجعها طبيبك المعالج."},
    {"icon":"clinician","title":"القرار بيد طبيبك","text":"لا يُنتَج أي شيء قبل أن يراجع طبيبك الخطة ويعتمدها."}]',
  '[{"icon":"clinician","title":"تحكم سريري كامل","text":"راجع الإعداد الافتراضي ومراحل العلاج، واطلب التعديلات، ولا تعتمد الخطة إلا عندما تحقق أهدافك السريرية."},
    {"icon":"digital","title":"عرض مرئي للحالة","text":"يدعم الإعداد المرئي الواضح نقاش العلاج مع المريض، ويساعده على فهم الخطة المقترحة وقبولها."},
    {"icon":"planning","title":"مراسلات أقل","text":"تساعد المراجعة الرقمية والتعديلات المنسّقة على تقليل وقت الكرسي وتكرار التواصل قبل الإنتاج."},
    {"icon":"team","title":"دعم في التخطيط دون فريق داخلي","text":"استفد من فريق متعدد التخصصات من أطباء الأسنان وفنيي الأسنان والمهندسين في حالات مختارة من المصففات الشفافة."}]');

-- ---------------------------------------------------------------------
-- Clear Aligners
-- ---------------------------------------------------------------------
select pg_temp.set_why('clear-aligners', 'en', 'Why clear aligners?',
  '[{"icon":"transparency","title":"Discreet","text":"Transparent aligners are barely noticeable in daily life, at work, and in photos."},
    {"icon":"smile","title":"Removable","text":"Take them out to eat and drink, and brush and floss your teeth as usual."},
    {"icon":"quality","title":"No brackets or wires","text":"Smooth, custom-made trays without metal brackets or wires."},
    {"icon":"planning","title":"A planned journey","text":"Your treatment follows a staged plan that your dentist has reviewed and approved in advance."}]',
  '[{"icon":"partnership","title":"Offer an aesthetic orthodontic option","text":"Meet the growing demand from adult patients for discreet orthodontic treatment."},
    {"icon":"digital","title":"Digitally planned, clinician approved","text":"Every case is planned digitally and produced only after your review and approval."},
    {"icon":"case","title":"Case-based support","text":"From case review to planning and production coordination, without the need for an in-house aligner laboratory."},
    {"icon":"workflow","title":"A structured workflow","text":"Clear steps and stages make it easier to schedule patients and to communicate progress."}]');

select pg_temp.set_why('clear-aligners', 'ar', 'لماذا المصففات الشفافة؟',
  '[{"icon":"transparency","title":"شبه غير مرئية","text":"المصففات الشفافة لا تكاد تُلاحظ في حياتك اليومية أو في العمل أو في الصور."},
    {"icon":"smile","title":"قابلة للإزالة","text":"انزعها عند الأكل والشرب، ونظّف أسنانك بالفرشاة والخيط كالمعتاد."},
    {"icon":"quality","title":"بدون حاصرات أو أسلاك","text":"قوالب ناعمة مصنوعة خصيصًا لك، بدون حاصرات معدنية أو أسلاك."},
    {"icon":"planning","title":"رحلة علاج مخطط لها","text":"يسير علاجك وفق خطة مقسمة إلى مراحل راجعها طبيبك واعتمدها مسبقًا."}]',
  '[{"icon":"partnership","title":"خيار تقويم تجميلي لمرضاك","text":"لبِّ الطلب المتزايد من المرضى البالغين على علاج تقويمي غير ملحوظ."},
    {"icon":"digital","title":"تخطيط رقمي واعتماد من الطبيب","text":"تُخطَّط كل حالة رقميًا، ولا تُنتَج إلا بعد مراجعتك واعتمادك."},
    {"icon":"case","title":"دعم قائم على الحالة","text":"من مراجعة الحالة إلى التخطيط وتنسيق الإنتاج، دون الحاجة إلى معمل مصففات داخلي."},
    {"icon":"workflow","title":"مسار عمل منظم","text":"خطوات ومراحل واضحة تسهّل جدولة المرضى والتواصل معهم بشأن تقدم العلاج."}]');

-- ---------------------------------------------------------------------
-- Clear Retainers
-- ---------------------------------------------------------------------
select pg_temp.set_why('clear-retainers', 'en', 'Why clear retainers?',
  '[{"icon":"quality","title":"Protect your result","text":"After orthodontic treatment, teeth tend to drift back. Wearing a retainer as instructed helps keep them in their new position."},
    {"icon":"transparency","title":"Discreet and comfortable","text":"Thin, transparent retainers are hard to notice and comfortable to wear."},
    {"icon":"smile","title":"Easy to remove and clean","text":"Take them out to eat and clean them easily as part of your daily routine."},
    {"icon":"check","title":"Made for your teeth","text":"Produced from your own dental records according to your dentist''s specifications."}]',
  '[{"icon":"clinician","title":"Complete the retention phase","text":"Support long-term stability after aligner or fixed orthodontic treatment with custom retainers."},
    {"icon":"records","title":"Made to your specifications","text":"Retainers are produced from patient-specific records and the specifications you approve."},
    {"icon":"digital","title":"Digital records","text":"Working from digital records can make it easier to coordinate future replacements."},
    {"icon":"case","title":"One coordinated pathway","text":"Combine treatment planning, aligners, and retention with one team and one workflow."}]');

select pg_temp.set_why('clear-retainers', 'ar', 'لماذا المثبتات الشفافة؟',
  '[{"icon":"quality","title":"حافظ على نتيجتك","text":"بعد علاج التقويم تميل الأسنان إلى العودة لمكانها السابق، وارتداء المثبت حسب تعليمات طبيبك يساعد على إبقائها في وضعها الجديد."},
    {"icon":"transparency","title":"غير ملحوظة ومريحة","text":"مثبتات رفيعة وشفافة يصعب ملاحظتها ومريحة عند الارتداء."},
    {"icon":"smile","title":"سهلة الإزالة والتنظيف","text":"انزعها عند الأكل ونظّفها بسهولة ضمن روتينك اليومي."},
    {"icon":"check","title":"مصنوعة لأسنانك","text":"تُنتَج من سجلات أسنانك الخاصة وفق المواصفات التي يحددها طبيبك."}]',
  '[{"icon":"clinician","title":"استكمال مرحلة التثبيت","text":"ادعم الاستقرار طويل الأمد بعد علاج المصففات أو التقويم الثابت بمثبتات مخصصة."},
    {"icon":"records","title":"وفق مواصفاتك","text":"تُنتَج المثبتات من سجلات المريض الخاصة ووفق المواصفات التي تعتمدها."},
    {"icon":"digital","title":"سجلات رقمية","text":"العمل من سجلات رقمية قد يسهّل تنسيق أي بديل في المستقبل."},
    {"icon":"case","title":"مسار واحد منسّق","text":"اجمع التخطيط العلاجي والمصففات والتثبيت مع فريق واحد ومسار عمل واحد."}]');

-- ---------------------------------------------------------------------
-- Removable aesthetic appliances (Snap-On Smile-style)
-- ---------------------------------------------------------------------
select pg_temp.set_why('snap-on-smile', 'en', 'Why a removable aesthetic appliance?',
  '[{"icon":"sparkles","title":"A quick aesthetic change","text":"A custom-made appliance worn over your natural teeth can change the look of your smile for everyday life, events, and photos."},
    {"icon":"smile","title":"Removable and reversible","text":"You can take it out at any time. It is designed to fit over your existing teeth, generally without drilling or reshaping them."},
    {"icon":"check","title":"Made from your own records","text":"Each appliance is produced from impressions or scans of your teeth for a personal fit."},
    {"icon":"clinician","title":"Assessed by your dentist","text":"Your dentist decides whether it is suitable for you. It is a cosmetic appliance and does not move teeth."}]',
  '[{"icon":"partnership","title":"A reversible cosmetic option","text":"Offer suitable patients an aesthetic solution that does not require irreversible tooth preparation."},
    {"icon":"transparency","title":"Supports case presentation","text":"Can help patients visualise an improved smile while they consider longer-term restorative or orthodontic treatment."},
    {"icon":"case","title":"Coordinated production","text":"Case coordination from records to production, subject to case suitability and confirmed availability."},
    {"icon":"quality","title":"Clear expectations","text":"Clearly separated from orthodontic treatment, so patients understand what the appliance can and cannot do."}]');

select pg_temp.set_why('snap-on-smile', 'ar', 'لماذا الجهاز التجميلي المتحرك؟',
  '[{"icon":"sparkles","title":"تغيير جمالي سريع","text":"جهاز مصنوع خصيصًا يُلبس فوق أسنانك الطبيعية ويغيّر مظهر ابتسامتك في حياتك اليومية وفي المناسبات والصور."},
    {"icon":"smile","title":"قابل للإزالة ويمكن التراجع عنه","text":"يمكنك نزعه في أي وقت، وهو مصمم ليُلبس فوق أسنانك الحالية دون حفر أو برد لها في العادة."},
    {"icon":"check","title":"مصنوع من سجلاتك","text":"يُنتَج كل جهاز من طبعات أو مسح رقمي لأسنانك ليناسبك تمامًا."},
    {"icon":"clinician","title":"بتقييم من طبيبك","text":"يقرر طبيبك مدى ملاءمته لك. وهو جهاز تجميلي لا يحرّك الأسنان."}]',
  '[{"icon":"partnership","title":"خيار تجميلي قابل للتراجع","text":"قدّم للمرضى المناسبين حلًا جماليًا لا يتطلب تحضيرًا للأسنان لا يمكن الرجوع عنه."},
    {"icon":"transparency","title":"يدعم عرض الحالة","text":"قد يساعد المريض على تصور ابتسامة أفضل أثناء تفكيره في علاج ترميمي أو تقويمي طويل الأمد."},
    {"icon":"case","title":"إنتاج منسّق","text":"تنسيق الحالة من السجلات حتى الإنتاج، وفق ملاءمة الحالة وتأكيد توفر الخدمة."},
    {"icon":"quality","title":"توقعات واضحة","text":"مفصول بوضوح عن العلاج التقويمي، ليعرف المريض ما يمكن للجهاز فعله وما لا يمكنه."}]');
