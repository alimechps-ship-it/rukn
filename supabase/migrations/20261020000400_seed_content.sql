-- =====================================================================
-- RUKN — initial approved content (English + Arabic).
-- Everything here is editable from /admin. No names, credentials,
-- statistics, testimonials, certifications or contact details are
-- invented: contact fields are left empty and hidden until configured.
-- Images are attached afterwards by scripts/seed-media.mjs.
-- =====================================================================

insert into public.languages (code, name, native_name, dir, enabled, is_default, sort_order) values
  ('en', 'English', 'English', 'ltr', true, true, 1),
  ('ar', 'Arabic', 'العربية', 'rtl', true, false, 2);

insert into public.site_settings (id, site_name, country_code) values (1, 'RUKN', 'EG');
insert into public.private_settings (id) values (1);

insert into public.site_settings_translations (locale, tagline, location_text, business_hours, footer_text,
  case_submission_instructions, default_seo_title, default_seo_description, cookie_banner_text, maintenance_message) values
('en', 'Digital Dental Solutions. Global Partnerships.', 'Based in Egypt. Connected to the World.', null,
 'RUKN is an Egypt-based multidisciplinary dental team of dentists, dental technicians, and engineers supporting dental professionals in Egypt and international markets.',
 'Thank you. Our team will review your inquiry and reply by e-mail with instructions for sharing case records through a secure channel. Please do not send patient records, scans, radiographs, or photographs until you receive those instructions.',
 'RUKN — Digital Dental Solutions. Global Partnerships.',
 'Egypt-based dental team supporting dental professionals worldwide with digital treatment planning, custom dental appliances, and case-based solutions.',
 'We use only the cookies needed to run this website, plus optional analytics if you allow them.',
 'The website is being updated. Please check back shortly.'),
('ar', 'حلول رقمية لطب الأسنان. شراكات عالمية.', 'مقرّنا مصر. ونتواصل مع العالم.', null,
 'ركن فريق متعدد التخصصات مقرّه مصر، يضم أطباء أسنان وفنيي أسنان ومهندسين، ويدعم المتخصصين في طب الأسنان في مصر والأسواق الدولية.',
 'شكرًا لك. سيراجع فريقنا استفسارك ويرد عليك عبر البريد الإلكتروني بتعليمات مشاركة سجلات الحالة من خلال قناة آمنة. يُرجى عدم إرسال سجلات المرضى أو المسوحات أو الصور الشعاعية أو الصور الفوتوغرافية قبل استلام هذه التعليمات.',
 'ركن — حلول رقمية لطب الأسنان. شراكات عالمية.',
 'فريق أسنان مقرّه مصر يدعم المتخصصين حول العالم بتخطيط العلاج الرقمي والأجهزة السنية المخصصة والحلول القائمة على الحالة.',
 'نستخدم فقط ملفات تعريف الارتباط اللازمة لتشغيل الموقع، إضافة إلى أدوات تحليل اختيارية إذا سمحت بها.',
 'يجري تحديث الموقع حاليًا. يُرجى العودة بعد قليل.');

-- ---------------------------------------------------------------------
-- Helpers (session-local)
-- ---------------------------------------------------------------------
create function pg_temp.mk_page(p_key text, p_slug text, p_template text, p_sort int, p_legal boolean,
  en_title text, en_seo_t text, en_seo_d text, ar_title text, ar_seo_t text, ar_seo_d text)
returns uuid language plpgsql as $$
declare v uuid; vr public.content_variant;
begin
  insert into public.pages (key, slug, template, status, sort_order, needs_legal_review, published_at)
  values (p_key, p_slug, p_template, 'published', p_sort, p_legal, now()) returning id into v;
  foreach vr in array array['draft', 'published']::public.content_variant[] loop
    insert into public.page_translations (page_id, locale, variant, title, seo_title, seo_description) values
      (v, 'en', vr, en_title, en_seo_t, en_seo_d), (v, 'ar', vr, ar_title, ar_seo_t, ar_seo_d);
  end loop;
  return v;
end $$;

create function pg_temp.mk_section(p_page text, p_key text, p_type text, p_sort int, p_settings jsonb, en jsonb, ar jsonb)
returns uuid language plpgsql as $$
declare v uuid; vr public.content_variant; loc text; t jsonb;
begin
  insert into public.content_sections (page_id, key, type, status, sort_order, settings, published_at)
  select id, p_key, p_type, 'published', p_sort, coalesce(p_settings, '{}'::jsonb), now() from public.pages where key = p_page
  returning id into v;
  foreach vr in array array['draft', 'published']::public.content_variant[] loop
    foreach loc in array array['en', 'ar'] loop
      t := case loc when 'en' then en else ar end;
      insert into public.content_section_translations (section_id, locale, variant, eyebrow, heading, subheading, body, items,
        primary_label, primary_href, secondary_label, secondary_href)
      values (v, loc, vr, t ->> 'eyebrow', t ->> 'heading', t ->> 'subheading', t ->> 'body', coalesce(t -> 'items', '[]'::jsonb),
        t ->> 'primary_label', t ->> 'primary_href', t ->> 'secondary_label', t ->> 'secondary_href');
    end loop;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Pages
-- ---------------------------------------------------------------------
select pg_temp.mk_page('home', '', 'home', 1, false,
  'Home', 'RUKN — Digital Dental Solutions. Global Partnerships.',
  'Connecting dental professionals worldwide with digital treatment planning, custom dental appliances, and professional case-based solutions.',
  'الرئيسية', 'ركن — حلول رقمية لطب الأسنان. شراكات عالمية.',
  'نربط المتخصصين في طب الأسنان حول العالم بتخطيط العلاج الرقمي والأجهزة السنية المخصصة والحلول المهنية القائمة على الحالة.');
select pg_temp.mk_page('services', 'services', 'standard', 2, false,
  'Services', 'Services — RUKN', 'Digital treatment planning, clear aligners, clear retainers, and removable aesthetic appliances for dental professionals.',
  'الخدمات', 'الخدمات — ركن', 'تخطيط العلاج الرقمي، والمصففات الشفافة، والمثبتات الشفافة، والأجهزة التجميلية المتحركة للمتخصصين في طب الأسنان.');
select pg_temp.mk_page('about', 'about', 'about', 3, false,
  'About Us', 'About RUKN — Multidisciplinary Dental Team in Egypt',
  'RUKN brings together dentists, dental technicians, and engineers to support dental professionals through coordinated digital workflows.',
  'من نحن', 'عن ركن — فريق أسنان متعدد التخصصات في مصر',
  'يجمع ركن أطباء أسنان وفنيي أسنان ومهندسين لدعم المتخصصين في طب الأسنان من خلال مسارات عمل رقمية منسّقة.');
select pg_temp.mk_page('partnerships', 'partnerships', 'partnerships', 4, false,
  'Global Partnerships', 'Global Partnerships — RUKN',
  'Partnership inquiries are welcome from dentists, clinics, dental laboratories, and distributors worldwide.',
  'الشراكات العالمية', 'الشراكات العالمية — ركن',
  'نرحب باستفسارات الشراكة من أطباء الأسنان والعيادات ومعامل الأسنان والموزعين حول العالم.');
select pg_temp.mk_page('case-inquiry', 'case-inquiry', 'case', 5, false,
  'Case Inquiry', 'Submit a Case Inquiry — RUKN',
  'Start a professional case inquiry with RUKN. We reply with secure instructions for sharing case records.',
  'استفسار عن حالة', 'إرسال استفسار عن حالة — ركن',
  'ابدأ استفسارًا مهنيًا عن حالة مع ركن. سنرد عليك بتعليمات آمنة لمشاركة سجلات الحالة.');
select pg_temp.mk_page('contact', 'contact', 'contact', 6, false,
  'Contact Us', 'Contact RUKN', 'Contact the RUKN team for professional inquiries.',
  'تواصل معنا', 'تواصل مع ركن', 'تواصل مع فريق ركن للاستفسارات المهنية.');
select pg_temp.mk_page('privacy', 'privacy-policy', 'legal', 7, true,
  'Privacy Policy', 'Privacy Policy — RUKN', 'How RUKN handles information submitted through this website.',
  'سياسة الخصوصية', 'سياسة الخصوصية — ركن', 'كيف يتعامل ركن مع المعلومات المرسلة عبر هذا الموقع.');

-- ---------------------------------------------------------------------
-- Home
-- ---------------------------------------------------------------------
select pg_temp.mk_section('home', 'hero', 'hero', 1, '{"media_slot":"home-hero"}',
  '{"eyebrow":"Based in Egypt. Connected to the World.","heading":"Digital Dental Solutions. Global Partnerships.","subheading":"Connecting dental professionals worldwide with digital treatment planning, custom dental appliances, and professional case-based solutions.","primary_label":"Submit a Case Inquiry","primary_href":"/case-inquiry","secondary_label":"Become a Partner","secondary_href":"/partnerships"}',
  '{"eyebrow":"مقرّنا مصر. ونتواصل مع العالم.","heading":"حلول رقمية لطب الأسنان. شراكات عالمية.","subheading":"نربط المتخصصين في طب الأسنان حول العالم بتخطيط العلاج الرقمي والأجهزة السنية المخصصة والحلول المهنية القائمة على الحالة.","primary_label":"إرسال استفسار عن حالة","primary_href":"/case-inquiry","secondary_label":"كن شريكًا","secondary_href":"/partnerships"}');

select pg_temp.mk_section('home', 'featured-services', 'services_grid', 2, '{"featured_only":true}',
  '{"eyebrow":"Services","heading":"Case-based solutions for dental professionals","subheading":"Each case is reviewed individually. Service availability is confirmed during case review.","primary_label":"View all services","primary_href":"/services"}',
  '{"eyebrow":"الخدمات","heading":"حلول قائمة على الحالة للمتخصصين في طب الأسنان","subheading":"تُراجَع كل حالة على حدة، ويُؤكَّد توفر الخدمة أثناء مراجعة الحالة.","primary_label":"عرض جميع الخدمات","primary_href":"/services"}');

select pg_temp.mk_section('home', 'about-summary', 'image_text', 3, '{"media_slot":"home-about"}',
  '{"eyebrow":"About RUKN","heading":"Clinical, technical, and engineering expertise — working together","body":"RUKN is an Egypt-based multidisciplinary dental team bringing together dentists, dental technicians, and engineers. We work collaboratively to support dental professionals, clinics, and laboratories in Egypt and international markets through digital workflows, case-based dental solutions, and professional partnerships.","primary_label":"About us","primary_href":"/about"}',
  '{"eyebrow":"عن ركن","heading":"خبرة سريرية وتقنية وهندسية — تعمل معًا","body":"ركن فريق أسنان متعدد التخصصات مقرّه مصر، يجمع أطباء أسنان وفنيي أسنان ومهندسين. نعمل بروح الفريق لدعم المتخصصين في طب الأسنان والعيادات والمعامل في مصر والأسواق الدولية من خلال مسارات العمل الرقمية والحلول السنية القائمة على الحالة والشراكات المهنية.","primary_label":"من نحن","primary_href":"/about"}');

select pg_temp.mk_section('home', 'how-it-works', 'steps', 4, null,
  '{"eyebrow":"How it works","heading":"A clinician-led workflow","subheading":"Nothing is manufactured before the treating clinician has reviewed and approved the plan.","items":[{"title":"Professional inquiry","text":"Send a short inquiry with your professional contact details and the service you need."},{"title":"Case review","text":"Our team reviews the request and confirms whether the case and service are suitable."},{"title":"Secure record submission","text":"We share instructions for submitting case records through a secure channel."},{"title":"Digital planning","text":"Where applicable, a digital treatment plan or design is prepared for your review."},{"title":"Clinician review and approval","text":"The treating clinician reviews, requests revisions, and approves according to the agreed workflow."},{"title":"Production after confirmation","text":"Manufacturing starts only after the required approvals and confirmation."}]}',
  '{"eyebrow":"آلية العمل","heading":"مسار عمل يقوده الطبيب المعالج","subheading":"لا يبدأ أي تصنيع قبل أن يراجع الطبيب المعالج الخطة ويعتمدها.","items":[{"title":"استفسار مهني","text":"أرسل استفسارًا قصيرًا يتضمن بيانات التواصل المهنية والخدمة المطلوبة."},{"title":"مراجعة الحالة","text":"يراجع فريقنا الطلب ويؤكد مدى ملاءمة الحالة والخدمة."},{"title":"إرسال السجلات بأمان","text":"نرسل لك تعليمات إرسال سجلات الحالة عبر قناة آمنة."},{"title":"التخطيط الرقمي","text":"عند الحاجة، نُعدّ خطة علاج أو تصميمًا رقميًا لمراجعتك."},{"title":"مراجعة الطبيب واعتماده","text":"يراجع الطبيب المعالج الخطة ويطلب التعديلات ويعتمدها وفق مسار العمل المتفق عليه."},{"title":"الإنتاج بعد التأكيد","text":"لا يبدأ التصنيع إلا بعد الحصول على الموافقات والتأكيدات المطلوبة."}]}');

select pg_temp.mk_section('home', 'partnership-benefits', 'benefits', 5, null,
  '{"eyebrow":"Professional partnerships","heading":"Why work with RUKN","items":[{"title":"Multidisciplinary team","text":"Dentists, dental technicians, and engineers collaborate on each workflow."},{"title":"Digital-first workflow","text":"Case review, planning, and communication are coordinated digitally."},{"title":"Clinician in control","text":"Treatment decisions and approvals remain with the treating dental professional."},{"title":"Case-based engagement","text":"Flexible arrangements tailored to the needs of practices, clinics, and laboratories."},{"title":"English and Arabic","text":"Professional communication in both languages."},{"title":"Cross-border collaboration","text":"Working from Egypt with professionals in international markets."}],"primary_label":"Become a Partner","primary_href":"/partnerships"}',
  '{"eyebrow":"شراكات مهنية","heading":"لماذا تعمل مع ركن","items":[{"title":"فريق متعدد التخصصات","text":"يتعاون أطباء الأسنان وفنيو الأسنان والمهندسون في كل مسار عمل."},{"title":"مسار عمل رقمي","text":"تُنسَّق مراجعة الحالة والتخطيط والتواصل رقميًا."},{"title":"القرار للطبيب المعالج","text":"تبقى قرارات العلاج والاعتمادات بيد الطبيب المعالج."},{"title":"تعاون قائم على الحالة","text":"ترتيبات مرنة تناسب احتياجات العيادات والمراكز والمعامل."},{"title":"العربية والإنجليزية","text":"تواصل مهني باللغتين."},{"title":"تعاون عابر للحدود","text":"نعمل من مصر مع المتخصصين في الأسواق الدولية."}],"primary_label":"كن شريكًا","primary_href":"/partnerships"}');

select pg_temp.mk_section('home', 'gallery', 'gallery', 6, '{"media_ids":[]}',
  '{"eyebrow":"Products","heading":"Featured product images"}',
  '{"eyebrow":"المنتجات","heading":"صور مختارة للمنتجات"}');

select pg_temp.mk_section('home', 'faq', 'faq', 7, '{"topic":"general"}',
  '{"eyebrow":"FAQ","heading":"Frequently asked questions"}',
  '{"eyebrow":"الأسئلة الشائعة","heading":"أسئلة متكررة"}');

select pg_temp.mk_section('home', 'contact-cta', 'cta', 8, null,
  '{"heading":"Have a case or a partnership in mind?","body":"Tell us what you need. We reply to professional inquiries from Egypt and around the world.","primary_label":"Submit a Case Inquiry","primary_href":"/case-inquiry","secondary_label":"Contact us","secondary_href":"/contact"}',
  '{"heading":"لديك حالة أو فكرة شراكة؟","body":"أخبرنا بما تحتاجه. نرد على الاستفسارات المهنية من مصر ومن حول العالم.","primary_label":"إرسال استفسار عن حالة","primary_href":"/case-inquiry","secondary_label":"تواصل معنا","secondary_href":"/contact"}');

-- ---------------------------------------------------------------------
-- Services index
-- ---------------------------------------------------------------------
select pg_temp.mk_section('services', 'hero', 'hero', 1, '{"compact":true}',
  '{"eyebrow":"Services","heading":"Digital workflows and custom dental solutions","subheading":"RUKN supports dental professionals case by case. Availability of each service is confirmed during case review."}',
  '{"eyebrow":"الخدمات","heading":"مسارات عمل رقمية وحلول سنية مخصصة","subheading":"يدعم ركن المتخصصين في طب الأسنان حالةً بحالة، ويُؤكَّد توفر كل خدمة أثناء مراجعة الحالة."}');
select pg_temp.mk_section('services', 'all-services', 'services_grid', 2, '{"featured_only":false}',
  '{"heading":"All services"}', '{"heading":"جميع الخدمات"}');
select pg_temp.mk_section('services', 'cta', 'cta', 3, null,
  '{"heading":"Not sure which service fits your case?","body":"Send a short inquiry and our team will advise on the next step.","primary_label":"Submit a Case Inquiry","primary_href":"/case-inquiry"}',
  '{"heading":"لست متأكدًا من الخدمة المناسبة لحالتك؟","body":"أرسل استفسارًا قصيرًا وسيرشدك فريقنا إلى الخطوة التالية.","primary_label":"إرسال استفسار عن حالة","primary_href":"/case-inquiry"}');

-- ---------------------------------------------------------------------
-- About
-- ---------------------------------------------------------------------
select pg_temp.mk_section('about', 'intro', 'hero', 1, '{"compact":true}',
  '{"eyebrow":"About Us","heading":"A multidisciplinary dental team based in Egypt","body":"RUKN is an Egypt-based dental solutions team bringing together dentists, dental technicians, and engineers to support dental professionals through coordinated digital workflows and custom dental solutions.\n\nOur multidisciplinary team combines clinical knowledge, technical expertise, and engineering capabilities to work with dental professionals and business partners across international markets.\n\nWorking from Egypt and engaging with clients worldwide, we aim to build reliable professional relationships and provide flexible, case-based solutions tailored to the needs of dental practices, clinics, and dental laboratories.\n\nAt RUKN, we believe that collaboration between clinical professionals, technical specialists, and engineers is essential to a well-coordinated dental workflow."}',
  '{"eyebrow":"من نحن","heading":"فريق أسنان متعدد التخصصات مقرّه مصر","body":"ركن فريق حلول سنية مقرّه مصر، يجمع أطباء أسنان وفنيي أسنان ومهندسين لدعم المتخصصين في طب الأسنان من خلال مسارات عمل رقمية منسّقة وحلول سنية مخصصة.\n\nيجمع فريقنا متعدد التخصصات بين المعرفة السريرية والخبرة التقنية والقدرات الهندسية للعمل مع المتخصصين في طب الأسنان وشركاء الأعمال في الأسواق الدولية.\n\nانطلاقًا من مصر وتواصلًا مع العملاء حول العالم، نسعى إلى بناء علاقات مهنية موثوقة وتقديم حلول مرنة قائمة على الحالة تلائم احتياجات عيادات الأسنان والمراكز ومعامل الأسنان.\n\nنؤمن في ركن بأن التعاون بين المتخصصين السريريين والفنيين والمهندسين أساس لمسار عمل سني منسّق جيدًا."}');
select pg_temp.mk_section('about', 'mission', 'rich_text', 2, '{"layout":"split"}',
  '{"eyebrow":"Our Mission","heading":"Coordinated support for dental professionals","body":"To support dental professionals, clinics, and laboratories with coordinated digital workflows and case-based dental solutions, built on close collaboration between clinical, technical, and engineering expertise."}',
  '{"eyebrow":"رسالتنا","heading":"دعم منسّق للمتخصصين في طب الأسنان","body":"دعم المتخصصين في طب الأسنان والعيادات والمعامل بمسارات عمل رقمية منسّقة وحلول سنية قائمة على الحالة، تقوم على تعاون وثيق بين الخبرات السريرية والتقنية والهندسية."}');
select pg_temp.mk_section('about', 'vision', 'rich_text', 3, '{"layout":"split"}',
  '{"eyebrow":"Our Vision","heading":"A trusted partner across borders","body":"To become a reliable professional partner for dental practices, clinics, laboratories, and distributors in Egypt and international markets."}',
  '{"eyebrow":"رؤيتنا","heading":"شريك موثوق عبر الحدود","body":"أن نكون شريكًا مهنيًا موثوقًا لعيادات الأسنان والمراكز والمعامل والموزعين في مصر والأسواق الدولية."}');
select pg_temp.mk_section('about', 'values', 'cards', 4, null,
  '{"eyebrow":"Our Values","heading":"How we work","items":[{"title":"Collaboration","text":"Clinical, technical, and engineering perspectives inform every case."},{"title":"Clinical responsibility","text":"The treating clinician reviews and approves every plan."},{"title":"Transparency","text":"Clear communication about scope, availability, and next steps."},{"title":"Privacy","text":"Patient information is shared only through secure, agreed channels."}]}',
  '{"eyebrow":"قيمنا","heading":"كيف نعمل","items":[{"title":"التعاون","text":"تُثري الرؤى السريرية والتقنية والهندسية كل حالة."},{"title":"المسؤولية السريرية","text":"يراجع الطبيب المعالج كل خطة ويعتمدها."},{"title":"الشفافية","text":"تواصل واضح بشأن النطاق والتوفر والخطوات التالية."},{"title":"الخصوصية","text":"لا تُشارَك معلومات المرضى إلا عبر قنوات آمنة ومتفق عليها."}]}');
select pg_temp.mk_section('about', 'approach', 'rich_text', 5, '{"layout":"split"}',
  '{"eyebrow":"Our Approach","heading":"Case by case, with the clinician","body":"Every engagement starts with a professional inquiry and a case review. Records are exchanged through a secure channel, plans are prepared digitally where applicable, and production starts only after the treating clinician has approved the plan and the order is confirmed."}',
  '{"eyebrow":"منهجنا","heading":"حالةً بحالة، بالتعاون مع الطبيب","body":"يبدأ كل تعاون باستفسار مهني ومراجعة للحالة. تُتبادل السجلات عبر قناة آمنة، وتُعدّ الخطط رقميًا عند الحاجة، ولا يبدأ الإنتاج إلا بعد اعتماد الطبيب المعالج للخطة وتأكيد الطلب."}');
select pg_temp.mk_section('about', 'team', 'team', 6, null,
  '{"eyebrow":"Our Team","heading":"Dentists, dental technicians, and engineers","body":"Our team brings together clinical, technical, and engineering backgrounds."}',
  '{"eyebrow":"فريقنا","heading":"أطباء أسنان وفنيو أسنان ومهندسون","body":"يجمع فريقنا خلفيات سريرية وتقنية وهندسية."}');
select pg_temp.mk_section('about', 'global', 'cta', 7, null,
  '{"eyebrow":"Global Partnerships","heading":"Working with professionals worldwide","body":"We welcome inquiries from dental professionals and organizations in Egypt and international markets.","primary_label":"Become a Partner","primary_href":"/partnerships"}',
  '{"eyebrow":"الشراكات العالمية","heading":"نعمل مع المتخصصين حول العالم","body":"نرحب بالاستفسارات من المتخصصين والمؤسسات في مصر والأسواق الدولية.","primary_label":"كن شريكًا","primary_href":"/partnerships"}');

-- ---------------------------------------------------------------------
-- Partnerships
-- ---------------------------------------------------------------------
select pg_temp.mk_section('partnerships', 'hero', 'hero', 1, '{"compact":true}',
  '{"eyebrow":"Global Partnerships","heading":"Your Dental Partner Across Borders","subheading":"Inquiries are welcome from dental professionals and organizations worldwide. Working from Egypt, we explore case-based and long-term professional collaborations."}',
  '{"eyebrow":"الشراكات العالمية","heading":"شريكك في طب الأسنان عبر الحدود","subheading":"نرحب باستفسارات المتخصصين والمؤسسات في طب الأسنان من جميع أنحاء العالم. ومن مقرّنا في مصر، نستكشف أشكال التعاون المهني القائم على الحالة وطويل الأمد."}');
select pg_temp.mk_section('partnerships', 'audiences', 'cards', 2, null,
  '{"eyebrow":"Who we work with","heading":"Partnership inquiries are welcome from","items":[{"title":"Dentists and orthodontists","text":"Case-based support with digital planning and clinician approval."},{"title":"Dental clinics and clinic groups","text":"Coordinated workflows across one or several locations."},{"title":"Dental laboratories","text":"Collaboration on digital workflows and case coordination."},{"title":"Distributors","text":"Discussions about representing RUKN solutions in your market."},{"title":"International dental service providers","text":"Cross-border professional collaboration."}]}',
  '{"eyebrow":"من نعمل معهم","heading":"نرحب باستفسارات الشراكة من","items":[{"title":"أطباء الأسنان وأخصائيي التقويم","text":"دعم قائم على الحالة مع تخطيط رقمي واعتماد الطبيب."},{"title":"عيادات ومجموعات عيادات الأسنان","text":"مسارات عمل منسّقة لفرع واحد أو عدة فروع."},{"title":"معامل الأسنان","text":"تعاون في مسارات العمل الرقمية وتنسيق الحالات."},{"title":"الموزعون","text":"مناقشة تمثيل حلول ركن في سوقك."},{"title":"مقدمو خدمات الأسنان الدوليون","text":"تعاون مهني عابر للحدود."}]}');
select pg_temp.mk_section('partnerships', 'form', 'inquiry_form', 3, '{"form":"partnership"}',
  '{"heading":"Partnership inquiry","body":"Tell us about your organization and the collaboration you have in mind. Please do not include patient information."}',
  '{"heading":"استفسار عن شراكة","body":"أخبرنا عن مؤسستك وشكل التعاون الذي تفكر فيه. يُرجى عدم إدراج أي معلومات عن المرضى."}');

-- ---------------------------------------------------------------------
-- Case inquiry
-- ---------------------------------------------------------------------
select pg_temp.mk_section('case-inquiry', 'hero', 'hero', 1, '{"compact":true}',
  '{"eyebrow":"Case Inquiry","heading":"Submit a case inquiry","subheading":"Start with your professional contact details and the service you need. We will reply with instructions for sharing records securely."}',
  '{"eyebrow":"استفسار عن حالة","heading":"أرسل استفسارًا عن حالة","subheading":"ابدأ ببيانات التواصل المهنية والخدمة المطلوبة، وسنرد عليك بتعليمات مشاركة السجلات بأمان."}');
select pg_temp.mk_section('case-inquiry', 'notice', 'notice', 2, null,
  '{"heading":"Please do not upload or paste patient records here","body":"This form is for professional contact information only. Do not include patient names, scans (STL), radiographs, or photographs. We will provide a secure channel after reviewing your inquiry."}',
  '{"heading":"يُرجى عدم إرسال سجلات المرضى عبر هذا النموذج","body":"هذا النموذج مخصص لبيانات التواصل المهنية فقط. لا تُدرج أسماء المرضى أو ملفات المسح (STL) أو الصور الشعاعية أو الصور الفوتوغرافية. سنوفر قناة آمنة بعد مراجعة استفسارك."}');
select pg_temp.mk_section('case-inquiry', 'form', 'inquiry_form', 3, '{"form":"case"}',
  '{"heading":"Your professional details"}', '{"heading":"بياناتك المهنية"}');
select pg_temp.mk_section('case-inquiry', 'workflow', 'steps', 4, null,
  '{"eyebrow":"What happens next","heading":"The clinical workflow","items":[{"title":"Professional inquiry","text":"You submit this form."},{"title":"Case review","text":"We confirm suitability and service availability."},{"title":"Secure record submission","text":"You share records through the secure channel we provide."},{"title":"Digital planning","text":"Where applicable, a plan or design is prepared."},{"title":"Clinician review and approval","text":"The treating clinician reviews and approves."},{"title":"Manufacturing after confirmation","text":"Production begins only after approvals and confirmation."}]}',
  '{"eyebrow":"ماذا يحدث بعد ذلك","heading":"مسار العمل السريري","items":[{"title":"استفسار مهني","text":"ترسل هذا النموذج."},{"title":"مراجعة الحالة","text":"نؤكد ملاءمة الحالة وتوفر الخدمة."},{"title":"إرسال السجلات بأمان","text":"تشارك السجلات عبر القناة الآمنة التي نوفرها."},{"title":"التخطيط الرقمي","text":"عند الحاجة، تُعدّ خطة أو تصميم."},{"title":"مراجعة الطبيب واعتماده","text":"يراجع الطبيب المعالج الخطة ويعتمدها."},{"title":"التصنيع بعد التأكيد","text":"لا يبدأ الإنتاج إلا بعد الموافقات والتأكيد."}]}');

-- ---------------------------------------------------------------------
-- Contact
-- ---------------------------------------------------------------------
select pg_temp.mk_section('contact', 'hero', 'hero', 1, '{"compact":true}',
  '{"eyebrow":"Contact Us","heading":"Talk to the RUKN team","subheading":"For professional inquiries from Egypt and around the world."}',
  '{"eyebrow":"تواصل معنا","heading":"تحدّث مع فريق ركن","subheading":"للاستفسارات المهنية من مصر ومن حول العالم."}');
select pg_temp.mk_section('contact', 'details', 'contact_details', 2, null,
  '{"heading":"Contact details"}', '{"heading":"بيانات التواصل"}');
select pg_temp.mk_section('contact', 'form', 'inquiry_form', 3, '{"form":"contact"}',
  '{"heading":"Send us a message","body":"Please do not include patient information in this form."}',
  '{"heading":"أرسل لنا رسالة","body":"يُرجى عدم إدراج أي معلومات عن المرضى في هذا النموذج."}');

-- ---------------------------------------------------------------------
-- Privacy (requires legal review before launch)
-- ---------------------------------------------------------------------
select pg_temp.mk_section('privacy', 'policy', 'rich_text', 1, null,
  '{"eyebrow":"Draft — legal review required before launch","heading":"Privacy Policy","body":"This policy explains how RUKN handles information submitted through this website.\n\n## Information we collect\n- Contact and inquiry forms: your name, e-mail address, country, organization, professional role, optional phone number, the service you are interested in, and your message.\n- Technical data needed to protect the forms from abuse, stored as a non-reversible hashed value rather than your IP address.\n- Optional analytics, only if enabled and, where required, only after you consent.\n\n## What we do not collect through this website\nPlease do not submit patient-identifiable information, scans, radiographs, or photographs through the website forms. Case records are exchanged only through a secure channel provided after review.\n\n## How we use the information\nWe use inquiry information to reply to you, review professional requests, and manage our professional relationship with you. We do not sell personal information.\n\n## Who can access it\nAccess is limited to authorized RUKN team members responsible for responding to inquiries. Our hosting and database providers process data on our behalf.\n\n## Retention\nInquiries are kept only as long as needed for the purposes above and then deleted or anonymized.\n\n## Your rights\nYou may ask us to access, correct, or delete the information you submitted by contacting us through the contact details on this website.\n\n## Changes\nWe may update this policy. The latest version is always published on this page."}',
  '{"eyebrow":"مسودة — تتطلب مراجعة قانونية قبل الإطلاق","heading":"سياسة الخصوصية","body":"توضح هذه السياسة كيفية تعامل ركن مع المعلومات المرسلة عبر هذا الموقع.\n\n## المعلومات التي نجمعها\n- نماذج التواصل والاستفسار: اسمك، وبريدك الإلكتروني، والدولة، والمؤسسة، والمسمى المهني، ورقم الهاتف (اختياري)، والخدمة التي تهتم بها، ورسالتك.\n- بيانات تقنية لازمة لحماية النماذج من الإساءة، تُحفظ كقيمة مشفّرة غير قابلة للاسترجاع بدلًا من عنوان IP الخاص بك.\n- أدوات تحليل اختيارية، فقط إذا كانت مفعّلة، وبعد موافقتك عند الاقتضاء.\n\n## ما لا نجمعه عبر هذا الموقع\nيُرجى عدم إرسال أي معلومات تحدد هوية المرضى أو ملفات مسح أو صور شعاعية أو صور فوتوغرافية عبر نماذج الموقع. تُتبادل سجلات الحالات فقط عبر قناة آمنة نوفرها بعد المراجعة.\n\n## كيف نستخدم المعلومات\nنستخدم معلومات الاستفسار للرد عليك ومراجعة الطلبات المهنية وإدارة علاقتنا المهنية معك. نحن لا نبيع المعلومات الشخصية.\n\n## من يمكنه الوصول إليها\nيقتصر الوصول على أعضاء فريق ركن المخوّلين بالرد على الاستفسارات. ويعالج مزودو الاستضافة وقاعدة البيانات البيانات نيابةً عنا.\n\n## مدة الاحتفاظ\nنحتفظ بالاستفسارات فقط للمدة اللازمة للأغراض المذكورة، ثم تُحذف أو تُجهَّل.\n\n## حقوقك\nيمكنك طلب الاطلاع على المعلومات التي أرسلتها أو تصحيحها أو حذفها بالتواصل معنا عبر بيانات التواصل في هذا الموقع.\n\n## التعديلات\nقد نُحدّث هذه السياسة، وتُنشر أحدث نسخة منها دائمًا في هذه الصفحة."}');

-- ---------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------
create function pg_temp.mk_service(p_slug text, p_sort int, p_featured boolean, p_cta text, en jsonb, ar jsonb)
returns uuid language plpgsql as $$
declare v uuid; vr public.content_variant; loc text; t jsonb;
begin
  insert into public.services (slug, status, sort_order, is_featured, cta_href, published_at)
  values (p_slug, 'published', p_sort, p_featured, p_cta, now()) returning id into v;
  foreach vr in array array['draft', 'published']::public.content_variant[] loop
    foreach loc in array array['en', 'ar'] loop
      t := case loc when 'en' then en else ar end;
      insert into public.service_translations (service_id, locale, variant, title, nav_title, summary, description,
        features_heading, features, workflow_heading, workflow, notice, cta_label, seo_title, seo_description)
      values (v, loc, vr, t ->> 'title', t ->> 'nav_title', t ->> 'summary', t ->> 'description',
        t ->> 'features_heading', coalesce(t -> 'features', '[]'), t ->> 'workflow_heading', coalesce(t -> 'workflow', '[]'),
        t ->> 'notice', t ->> 'cta_label', t ->> 'seo_title', t ->> 'seo_description');
    end loop;
  end loop;
  return v;
end $$;

select pg_temp.mk_service('digital-treatment-planning', 1, true, '/case-inquiry?service=digital-treatment-planning',
  '{"title":"Digital Orthodontic Treatment Planning","nav_title":"Digital Treatment Planning","summary":"Digital case review, virtual treatment setup, and staging for clinician review and approval.","description":"RUKN supports dental professionals with digital treatment-planning workflows for selected clear aligner cases, including digital case review, virtual treatment setup, and treatment staging for clinician review and approval.","features_heading":"What the service includes","features":["Digital case review","Virtual treatment setup","Treatment staging, where applicable","Clinician review","Plan revisions according to the agreed workflow","Coordination before production"],"workflow_heading":"How planning works","workflow":[{"title":"Inquiry and case review","text":"We confirm whether the case is suitable for digital planning."},{"title":"Secure records","text":"Records are shared through the secure channel we provide."},{"title":"Virtual setup","text":"A virtual treatment setup and staging are prepared where applicable."},{"title":"Clinician approval","text":"The treating clinician reviews, requests revisions, and approves."}],"notice":"Treatment planning is offered for selected cases. Suitability is confirmed during case review. All clinical decisions remain with the treating clinician.","cta_label":"Request Treatment Planning","seo_title":"Digital Orthodontic Treatment Planning — RUKN","seo_description":"Digital case review, virtual treatment setup, and treatment staging for clinician review and approval."}',
  '{"title":"التخطيط الرقمي لعلاج تقويم الأسنان","nav_title":"التخطيط الرقمي للعلاج","summary":"مراجعة رقمية للحالة، وإعداد علاجي افتراضي، وتقسيم مراحل العلاج لمراجعة الطبيب واعتماده.","description":"يدعم ركن المتخصصين في طب الأسنان بمسارات عمل رقمية لتخطيط العلاج لحالات مختارة من المصففات الشفافة، تشمل المراجعة الرقمية للحالة، والإعداد العلاجي الافتراضي، وتقسيم مراحل العلاج لمراجعة الطبيب المعالج واعتماده.","features_heading":"ما تشمله الخدمة","features":["مراجعة رقمية للحالة","إعداد علاجي افتراضي","تقسيم مراحل العلاج عند الاقتضاء","مراجعة الطبيب المعالج","تعديلات الخطة وفق مسار العمل المتفق عليه","التنسيق قبل الإنتاج"],"workflow_heading":"كيف يتم التخطيط","workflow":[{"title":"الاستفسار ومراجعة الحالة","text":"نتأكد من ملاءمة الحالة للتخطيط الرقمي."},{"title":"السجلات الآمنة","text":"تُشارَك السجلات عبر القناة الآمنة التي نوفرها."},{"title":"الإعداد الافتراضي","text":"يُعدّ الإعداد العلاجي الافتراضي وتقسيم المراحل عند الاقتضاء."},{"title":"اعتماد الطبيب","text":"يراجع الطبيب المعالج الخطة ويطلب التعديلات ويعتمدها."}],"notice":"يُقدَّم تخطيط العلاج لحالات مختارة، وتُؤكَّد ملاءمة الحالة أثناء مراجعتها. تبقى جميع القرارات السريرية بيد الطبيب المعالج.","cta_label":"اطلب تخطيط العلاج","seo_title":"التخطيط الرقمي لعلاج تقويم الأسنان — ركن","seo_description":"مراجعة رقمية للحالة، وإعداد علاجي افتراضي، وتقسيم مراحل العلاج لمراجعة الطبيب واعتماده."}');

select pg_temp.mk_service('clear-aligners', 2, true, '/case-inquiry?service=clear-aligners',
  '{"title":"Custom Clear Aligner Solutions","nav_title":"Clear Aligners","summary":"Case-based clear aligner solutions coordinated through digital workflows and professional collaboration.","description":"Explore case-based clear aligner solutions coordinated through digital workflows and professional collaboration.","features_heading":"Designed around your case","features":["Case review before any commitment","Digital treatment planning for clinician approval","Production only after approval and confirmation","Coordination throughout the case"],"workflow_heading":"From inquiry to production","workflow":[{"title":"Case inquiry","text":"Send your professional details and the case type."},{"title":"Case review","text":"We confirm suitability and service availability for your case."},{"title":"Planning and approval","text":"A digital plan is prepared and approved by the treating clinician."},{"title":"Production","text":"Aligners are produced after the plan is approved and the order is confirmed."}],"notice":"Clear aligner services are subject to case suitability and confirmed service availability in your market.","cta_label":"Request a Clear Aligner Quote","seo_title":"Custom Clear Aligner Solutions — RUKN","seo_description":"Case-based clear aligner solutions coordinated through digital workflows and professional collaboration."}',
  '{"title":"حلول المصففات الشفافة المخصصة","nav_title":"المصففات الشفافة","summary":"حلول مصففات شفافة قائمة على الحالة، منسّقة عبر مسارات عمل رقمية وتعاون مهني.","description":"استكشف حلول المصففات الشفافة القائمة على الحالة، والمنسّقة عبر مسارات عمل رقمية وتعاون مهني.","features_heading":"مصممة حول حالتك","features":["مراجعة الحالة قبل أي التزام","تخطيط رقمي للعلاج لاعتماد الطبيب","الإنتاج فقط بعد الاعتماد والتأكيد","تنسيق مستمر طوال الحالة"],"workflow_heading":"من الاستفسار إلى الإنتاج","workflow":[{"title":"الاستفسار عن الحالة","text":"أرسل بياناتك المهنية ونوع الحالة."},{"title":"مراجعة الحالة","text":"نؤكد ملاءمة الحالة وتوفر الخدمة لها."},{"title":"التخطيط والاعتماد","text":"تُعدّ خطة رقمية ويعتمدها الطبيب المعالج."},{"title":"الإنتاج","text":"تُنتَج المصففات بعد اعتماد الخطة وتأكيد الطلب."}],"notice":"تخضع خدمات المصففات الشفافة لملاءمة الحالة وتأكيد توفر الخدمة في سوقك.","cta_label":"اطلب عرض سعر للمصففات الشفافة","seo_title":"حلول المصففات الشفافة المخصصة — ركن","seo_description":"حلول مصففات شفافة قائمة على الحالة، منسّقة عبر مسارات عمل رقمية وتعاون مهني."}');

select pg_temp.mk_service('clear-retainers', 3, true, '/case-inquiry?service=clear-retainers',
  '{"title":"Custom Clear Retainers","nav_title":"Clear Retainers","summary":"Custom clear retainers based on patient-specific records and the clinician''s approved specifications.","description":"Explore custom clear retainer solutions based on patient-specific dental records and the specifications approved by the treating dental professional.","features_heading":"What to expect","features":["Based on patient-specific dental records","Specifications approved by the treating professional","Records exchanged through a secure channel","Production after confirmation"],"notice":"Retainer services are subject to case review and confirmed service availability.","cta_label":"Request a Retainer Quote","seo_title":"Custom Clear Retainers — RUKN","seo_description":"Custom clear retainers based on patient-specific dental records and clinician-approved specifications."}',
  '{"title":"المثبتات الشفافة المخصصة","nav_title":"المثبتات الشفافة","summary":"مثبتات شفافة مخصصة تعتمد على سجلات المريض الخاصة ومواصفات يعتمدها الطبيب.","description":"استكشف حلول المثبتات الشفافة المخصصة المبنية على سجلات الأسنان الخاصة بكل مريض والمواصفات التي يعتمدها الطبيب المعالج.","features_heading":"ما يمكن توقعه","features":["مبنية على سجلات الأسنان الخاصة بالمريض","مواصفات يعتمدها الطبيب المعالج","تبادل السجلات عبر قناة آمنة","الإنتاج بعد التأكيد"],"notice":"تخضع خدمات المثبتات لمراجعة الحالة وتأكيد توفر الخدمة.","cta_label":"اطلب عرض سعر للمثبتات","seo_title":"المثبتات الشفافة المخصصة — ركن","seo_description":"مثبتات شفافة مخصصة تعتمد على سجلات المريض ومواصفات يعتمدها الطبيب."}');

select pg_temp.mk_service('snap-on-smile', 4, true, '/case-inquiry?service=snap-on-smile',
  '{"title":"Removable Aesthetic Dental Appliances","nav_title":"Snap-On Smile Solutions","summary":"An inquiry and case-coordination pathway for removable aesthetic appliances, including Snap-On Smile-style solutions.","description":"RUKN provides a professional inquiry and case-coordination pathway for removable aesthetic dental appliances, including Snap-On Smile-style solutions, subject to case suitability and confirmed service availability.","features_heading":"Important to know","features":["Removable aesthetic appliances are not orthodontic aligners and do not move teeth","Suitability is assessed case by case with the treating dentist","Coordination from inquiry to confirmed production"],"notice":"Removable aesthetic appliances are cosmetic, removable devices. They are different from clear aligners, which are orthodontic appliances. Availability is confirmed during case review.","cta_label":"Explore Snap-On Solutions","seo_title":"Removable Aesthetic Dental Appliances — RUKN","seo_description":"Professional inquiry and case coordination for removable aesthetic dental appliances, including Snap-On Smile-style solutions."}',
  '{"title":"الأجهزة السنية التجميلية المتحركة","nav_title":"حلول Snap-On Smile","summary":"مسار للاستفسار وتنسيق الحالات للأجهزة التجميلية المتحركة، بما في ذلك الحلول المشابهة لـ Snap-On Smile.","description":"يوفر ركن مسارًا مهنيًا للاستفسار وتنسيق الحالات للأجهزة السنية التجميلية المتحركة، بما في ذلك الحلول المشابهة لـ Snap-On Smile، وذلك وفقًا لملاءمة الحالة وتأكيد توفر الخدمة.","features_heading":"من المهم معرفة","features":["الأجهزة التجميلية المتحركة ليست مصففات تقويمية ولا تحرّك الأسنان","تُقيَّم الملاءمة لكل حالة مع طبيب الأسنان المعالج","تنسيق من الاستفسار حتى تأكيد الإنتاج"],"notice":"الأجهزة التجميلية المتحركة أجهزة تجميلية قابلة للإزالة، وهي تختلف عن المصففات الشفافة التي تُعدّ أجهزة تقويمية. يُؤكَّد التوفر أثناء مراجعة الحالة.","cta_label":"استكشف حلول Snap-On","seo_title":"الأجهزة السنية التجميلية المتحركة — ركن","seo_description":"استفسار مهني وتنسيق حالات للأجهزة السنية التجميلية المتحركة، بما في ذلك الحلول المشابهة لـ Snap-On Smile."}');

-- ---------------------------------------------------------------------
-- FAQs
-- ---------------------------------------------------------------------
create function pg_temp.mk_faq(p_sort int, q_en text, a_en text, q_ar text, a_ar text)
returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.faqs (topic, status, sort_order) values ('general', 'published', p_sort) returning id into v;
  insert into public.faq_translations (faq_id, locale, question, answer) values (v, 'en', q_en, a_en), (v, 'ar', q_ar, a_ar);
end $$;

select pg_temp.mk_faq(1, 'Who does RUKN work with?',
  'We work with dental professionals and organizations — dentists, orthodontists, clinics, dental laboratories, and distributors — in Egypt and international markets.',
  'مع من يعمل ركن؟',
  'نعمل مع المتخصصين والمؤسسات في مجال طب الأسنان — أطباء الأسنان وأخصائيي التقويم والعيادات ومعامل الأسنان والموزعين — في مصر والأسواق الدولية.');
select pg_temp.mk_faq(2, 'How do I start a case?',
  'Submit a case inquiry with your professional contact details and the service you need. After reviewing it, we reply with instructions for sharing case records through a secure channel.',
  'كيف أبدأ حالة؟',
  'أرسل استفسارًا عن الحالة يتضمن بيانات التواصل المهنية والخدمة المطلوبة. بعد مراجعته، نرد عليك بتعليمات مشاركة سجلات الحالة عبر قناة آمنة.');
select pg_temp.mk_faq(3, 'Can I send patient records through the website?',
  'No. Please do not send patient names, scans, radiographs, or photographs through the website forms. We provide a secure channel after reviewing your inquiry.',
  'هل يمكنني إرسال سجلات المرضى عبر الموقع؟',
  'لا. يُرجى عدم إرسال أسماء المرضى أو ملفات المسح أو الصور الشعاعية أو الصور الفوتوغرافية عبر نماذج الموقع. نوفر قناة آمنة بعد مراجعة استفسارك.');
select pg_temp.mk_faq(4, 'Who approves the treatment plan?',
  'The treating clinician. Plans are prepared for clinician review, revised according to the agreed workflow, and manufacturing starts only after approval and confirmation.',
  'من يعتمد خطة العلاج؟',
  'الطبيب المعالج. تُعدّ الخطط لمراجعة الطبيب وتُعدَّل وفق مسار العمل المتفق عليه، ولا يبدأ التصنيع إلا بعد الاعتماد والتأكيد.');
select pg_temp.mk_faq(5, 'Are your services available in my country?',
  'Availability depends on the case, the service, and the arrangements that apply in your market. Send an inquiry and we will confirm what is possible.',
  'هل خدماتكم متاحة في بلدي؟',
  'يعتمد التوفر على الحالة والخدمة والترتيبات المعمول بها في سوقك. أرسل استفسارًا وسنؤكد لك ما هو ممكن.');
select pg_temp.mk_faq(6, 'Is a Snap-On Smile-style appliance the same as a clear aligner?',
  'No. Removable aesthetic appliances are cosmetic devices worn over the teeth. Clear aligners are orthodontic appliances used in planned tooth movement.',
  'هل الجهاز المشابه لـ Snap-On Smile هو نفسه المصفف الشفاف؟',
  'لا. الأجهزة التجميلية المتحركة أجهزة تجميلية تُلبس فوق الأسنان، أما المصففات الشفافة فهي أجهزة تقويمية تُستخدم في تحريك الأسنان وفق خطة علاجية.');

-- ---------------------------------------------------------------------
-- Navigation
-- ---------------------------------------------------------------------
create function pg_temp.mk_nav(p_loc text, p_href text, p_sort int, en text, ar text)
returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.navigation_items (location, href, sort_order) values (p_loc, p_href, p_sort) returning id into v;
  insert into public.navigation_item_translations (item_id, locale, label) values (v, 'en', en), (v, 'ar', ar);
end $$;

select pg_temp.mk_nav('header', '/services', 1, 'Services', 'الخدمات');
select pg_temp.mk_nav('header', '/services/digital-treatment-planning', 2, 'Treatment Planning', 'تخطيط العلاج');
select pg_temp.mk_nav('header', '/about', 3, 'About', 'من نحن');
select pg_temp.mk_nav('header', '/partnerships', 4, 'Partnerships', 'الشراكات');
select pg_temp.mk_nav('header', '/contact', 5, 'Contact', 'تواصل معنا');
select pg_temp.mk_nav('footer', '/services/digital-treatment-planning', 1, 'Digital Treatment Planning', 'التخطيط الرقمي للعلاج');
select pg_temp.mk_nav('footer', '/services/clear-aligners', 2, 'Clear Aligners', 'المصففات الشفافة');
select pg_temp.mk_nav('footer', '/services/clear-retainers', 3, 'Clear Retainers', 'المثبتات الشفافة');
select pg_temp.mk_nav('footer', '/services/snap-on-smile', 4, 'Snap-On Smile Solutions', 'حلول Snap-On Smile');
select pg_temp.mk_nav('footer', '/about', 5, 'About Us', 'من نحن');
select pg_temp.mk_nav('footer', '/partnerships', 6, 'Global Partnerships', 'الشراكات العالمية');
select pg_temp.mk_nav('footer', '/case-inquiry', 7, 'Case Inquiry', 'استفسار عن حالة');
select pg_temp.mk_nav('footer', '/contact', 8, 'Contact Us', 'تواصل معنا');
select pg_temp.mk_nav('footer_legal', '/privacy-policy', 1, 'Privacy Policy', 'سياسة الخصوصية');

-- ---------------------------------------------------------------------
-- Interface strings
-- ---------------------------------------------------------------------
insert into public.translations (namespace, key, locale, value)
select 'ui', k, l, v from (values
  ('skip_to_content', 'Skip to content', 'انتقل إلى المحتوى'),
  ('nav.menu', 'Menu', 'القائمة'),
  ('nav.close', 'Close menu', 'إغلاق القائمة'),
  ('nav.cta', 'Submit a Case Inquiry', 'إرسال استفسار عن حالة'),
  ('lang.label', 'Language', 'اللغة'),
  ('services.learn_more', 'Learn more', 'اعرف المزيد'),
  ('services.price_from', 'From', 'ابتداءً من'),
  ('services.related', 'Other services', 'خدمات أخرى'),
  ('image.illustrative', 'Illustrative image', 'صورة توضيحية'),
  ('team.empty', 'Team profiles will be published soon.', 'ستُنشر الملفات التعريفية للفريق قريبًا.'),
  ('contact.email', 'E-mail', 'البريد الإلكتروني'),
  ('contact.whatsapp', 'WhatsApp', 'واتساب'),
  ('contact.location', 'Location', 'الموقع'),
  ('contact.hours', 'Business hours', 'ساعات العمل'),
  ('contact.social', 'Social media', 'وسائل التواصل الاجتماعي'),
  ('contact.none', 'Please use the form on this page to reach us.', 'يُرجى استخدام النموذج في هذه الصفحة للتواصل معنا.'),
  ('form.name', 'Full name', 'الاسم الكامل'),
  ('form.email', 'Professional e-mail', 'البريد الإلكتروني المهني'),
  ('form.country', 'Country', 'الدولة'),
  ('form.organization', 'Clinic, laboratory, or organization', 'العيادة أو المعمل أو المؤسسة'),
  ('form.phone', 'Phone (optional)', 'الهاتف (اختياري)'),
  ('form.role', 'Professional role', 'المسمى المهني'),
  ('form.role.select', 'Select your role', 'اختر مسماك المهني'),
  ('form.role.dentist', 'Dentist', 'طبيب أسنان'),
  ('form.role.orthodontist', 'Orthodontist', 'أخصائي تقويم أسنان'),
  ('form.role.technician', 'Dental technician', 'فني أسنان'),
  ('form.role.lab', 'Dental laboratory', 'معمل أسنان'),
  ('form.role.clinic_manager', 'Clinic manager', 'مدير عيادة'),
  ('form.role.distributor', 'Distributor', 'موزع'),
  ('form.role.other', 'Other', 'أخرى'),
  ('form.service', 'Service of interest', 'الخدمة المطلوبة'),
  ('form.service.select', 'Select a service', 'اختر خدمة'),
  ('form.service.general', 'General / not sure', 'عام / غير متأكد'),
  ('form.message', 'Message', 'الرسالة'),
  ('form.message.case_hint', 'Briefly describe the request. Do not include patient-identifiable information.', 'صف الطلب باختصار. لا تُدرج أي معلومات تحدد هوية المريض.'),
  ('form.consent', 'I agree that RUKN may use these details to respond to my inquiry, as described in the Privacy Policy.', 'أوافق على أن يستخدم ركن هذه البيانات للرد على استفساري وفقًا لسياسة الخصوصية.'),
  ('form.required', 'Required', 'مطلوب'),
  ('form.submit', 'Send inquiry', 'إرسال الاستفسار'),
  ('form.submitting', 'Sending…', 'جارٍ الإرسال…'),
  ('form.success_title', 'Inquiry received', 'تم استلام الاستفسار'),
  ('form.success', 'Thank you. Your inquiry has been received and our team will reply by e-mail.', 'شكرًا لك. تم استلام استفسارك وسيرد عليك فريقنا عبر البريد الإلكتروني.'),
  ('form.error.validation', 'Please check the highlighted fields.', 'يُرجى مراجعة الحقول المحددة.'),
  ('form.error.rate_limited', 'Too many submissions. Please try again later.', 'عدد كبير من المحاولات. يُرجى المحاولة لاحقًا.'),
  ('form.error.generic', 'Your inquiry could not be sent. Please try again later.', 'تعذّر إرسال استفسارك. يُرجى المحاولة لاحقًا.'),
  ('form.error.captcha', 'Verification failed. Please try again.', 'فشل التحقق. يُرجى المحاولة مرة أخرى.'),
  ('form.error.name', 'Please enter your name.', 'يُرجى إدخال اسمك.'),
  ('form.error.email', 'Please enter a valid e-mail address.', 'يُرجى إدخال بريد إلكتروني صحيح.'),
  ('form.error.consent', 'Please confirm your consent.', 'يُرجى تأكيد موافقتك.'),
  ('form.error.message', 'Message is too long.', 'الرسالة طويلة جدًا.'),
  ('footer.rights', 'All rights reserved.', 'جميع الحقوق محفوظة.'),
  ('footer.services', 'Services', 'الخدمات'),
  ('footer.company', 'Company', 'الشركة'),
  ('footer.contact', 'Contact', 'التواصل'),
  ('cookie.accept', 'Allow analytics', 'السماح بالتحليلات'),
  ('cookie.decline', 'Essential only', 'الضرورية فقط'),
  ('notfound.title', 'Page not found', 'الصفحة غير موجودة'),
  ('notfound.text', 'The page you are looking for does not exist or has moved.', 'الصفحة التي تبحث عنها غير موجودة أو تم نقلها.'),
  ('notfound.home', 'Back to home', 'العودة إلى الرئيسية'),
  ('legal.review_banner', 'Draft — this page must be reviewed by a legal professional before launch.', 'مسودة — يجب مراجعة هذه الصفحة من مختص قانوني قبل الإطلاق.'),
  ('preview.banner', 'Preview mode — you are viewing unpublished drafts.', 'وضع المعاينة — أنت تشاهد مسودات غير منشورة.'),
  ('preview.exit', 'Exit preview', 'الخروج من المعاينة')
) as s(k, en, ar)
cross join lateral (values ('en', s.en), ('ar', s.ar)) as x(l, v);
