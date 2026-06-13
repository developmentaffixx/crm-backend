-- ─────────────────────────────────────────────────────────────────────────────
-- PROPOSAL ENGINE — Seed Data
-- Service Templates + Industry Blocks + Persona Blocks + Sample Case Studies
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVICE TEMPLATES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_service_templates (service_key, service_name, sections) VALUES
('smm', 'Social Media Marketing', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover'),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text'),
  JSON_OBJECT('key','current_presence','title','Current Social Presence','type','text'),
  JSON_OBJECT('key','challenges','title','Challenges','type','list'),
  JSON_OBJECT('key','opportunities','title','Opportunities','type','list'),
  JSON_OBJECT('key','strategy','title','Social Media Strategy','type','text'),
  JSON_OBJECT('key','content_plan','title','Content Plan','type','table'),
  JSON_OBJECT('key','deliverables','title','Deliverables','type','list'),
  JSON_OBJECT('key','expected_outcomes','title','Expected Outcomes','type','list'),
  JSON_OBJECT('key','case_studies','title','Case Studies','type','case_studies'),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline'),
  JSON_OBJECT('key','investment','title','Investment','type','pricing'),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps')
)),

('website_dev', 'Website Development', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover'),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text'),
  JSON_OBJECT('key','current_analysis','title','Current Website Analysis','type','text'),
  JSON_OBJECT('key','challenges','title','Website Challenges','type','list'),
  JSON_OBJECT('key','objectives','title','Website Objectives','type','list'),
  JSON_OBJECT('key','proposed_structure','title','Proposed Website Structure','type','text'),
  JSON_OBJECT('key','features','title','Features & Functionalities','type','list'),
  JSON_OBJECT('key','pages_included','title','Pages Included','type','list'),
  JSON_OBJECT('key','tech_specs','title','Technical Specifications','type','text'),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline'),
  JSON_OBJECT('key','investment','title','Investment','type','pricing'),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps')
)),

('seo', 'SEO', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover'),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text'),
  JSON_OBJECT('key','current_analysis','title','Current SEO Analysis','type','text'),
  JSON_OBJECT('key','keywords','title','Keyword Opportunities','type','list'),
  JSON_OBJECT('key','competitor_analysis','title','Competitor Analysis','type','text'),
  JSON_OBJECT('key','technical_issues','title','Technical SEO Issues','type','list'),
  JSON_OBJECT('key','strategy','title','SEO Strategy','type','text'),
  JSON_OBJECT('key','monthly_activities','title','Monthly SEO Activities','type','list'),
  JSON_OBJECT('key','expected_growth','title','Expected Growth','type','list'),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline'),
  JSON_OBJECT('key','investment','title','Investment','type','pricing'),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps')
)),

('performance_marketing', 'Performance Marketing', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover'),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text'),
  JSON_OBJECT('key','current_situation','title','Current Marketing Situation','type','text'),
  JSON_OBJECT('key','target_audience','title','Target Audience','type','text'),
  JSON_OBJECT('key','funnel_strategy','title','Funnel Strategy','type','text'),
  JSON_OBJECT('key','campaign_structure','title','Campaign Structure','type','text'),
  JSON_OBJECT('key','creative_strategy','title','Creative Strategy','type','text'),
  JSON_OBJECT('key','lead_gen_process','title','Lead Generation Process','type','text'),
  JSON_OBJECT('key','expected_outcomes','title','Expected Outcomes','type','list'),
  JSON_OBJECT('key','ad_budget','title','Ad Budget Recommendation','type','pricing'),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline'),
  JSON_OBJECT('key','investment','title','Investment','type','pricing'),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps')
)),

('personal_branding', 'Personal Branding', JSON_ARRAY(
  JSON_OBJECT('key','cover','title','Cover Page','type','cover'),
  JSON_OBJECT('key','executive_summary','title','Executive Summary','type','text'),
  JSON_OBJECT('key','brand_assessment','title','Personal Brand Assessment','type','text'),
  JSON_OBJECT('key','positioning','title','Positioning Analysis','type','text'),
  JSON_OBJECT('key','audience','title','Audience Analysis','type','text'),
  JSON_OBJECT('key','content_strategy','title','Content Strategy','type','text'),
  JSON_OBJECT('key','platform_strategy','title','Platform Strategy','type','text'),
  JSON_OBJECT('key','deliverables','title','Deliverables','type','list'),
  JSON_OBJECT('key','growth_roadmap','title','Growth Roadmap','type','timeline'),
  JSON_OBJECT('key','expected_outcomes','title','Expected Outcomes','type','list'),
  JSON_OBJECT('key','timeline','title','Timeline','type','timeline'),
  JSON_OBJECT('key','investment','title','Investment','type','pricing'),
  JSON_OBJECT('key','next_steps','title','Next Steps','type','steps')
));

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDUSTRY BLOCKS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Education
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('education', 'Education', 'smm',
 'In today''s digital-first world, parents actively research schools online before making admission decisions. A strong social media presence builds trust, showcases school culture, and directly drives admission inquiries.',
 JSON_ARRAY('Low admissions compared to capacity', 'Low parent awareness in surrounding areas', 'No active online presence or engagement', 'Competitors gaining traction with digital marketing'),
 JSON_ARRAY('Large parent community active on social media', 'High demand for quality education content', 'Video content (reels/shorts) highly engaging for parents', 'Word-of-mouth can be amplified digitally'),
 JSON_ARRAY('Increased admission inquiries', 'More school visits from prospective parents', 'Stronger brand recognition in local area', 'Active online community of current parents')),

('education', 'Education', 'website_dev',
 'A professional website is the first impression parents get of your institution. It must communicate trust, quality, and accessibility while providing easy admission inquiry options.',
 JSON_ARRAY('Outdated or no website', 'Poor mobile experience', 'No online admission inquiry form', 'Lack of SEO visibility for local searches'),
 JSON_ARRAY('Parents search online before visiting', 'Virtual tours can increase interest', 'Online forms reduce admission friction', 'Blog content can improve search rankings'),
 JSON_ARRAY('Professional online presence', 'Increased online admission inquiries', 'Better search engine visibility', 'Reduced manual inquiry handling')),

('education', 'Education', 'seo',
 'When parents search for schools in your area, your institution needs to appear at the top. SEO ensures consistent organic visibility and drives admission inquiries without ongoing ad spend.',
 JSON_ARRAY('Not appearing in local search results', 'Competitors ranking higher for key terms', 'No Google Business Profile optimization', 'Missing relevant content for parent queries'),
 JSON_ARRAY('High-intent parent searches happening daily', 'Local SEO has low competition in education', 'Content marketing builds long-term authority', 'Google Business Profile drives direct calls'),
 JSON_ARRAY('Top 3 rankings for local school searches', 'Increased organic website traffic', 'More direct calls and map visits', 'Reduced dependency on paid ads')),

('education', 'Education', 'performance_marketing',
 'Performance marketing allows you to reach parents actively searching for schools in your area. With targeted ads, you can drive qualified admission inquiries at a predictable cost.',
 JSON_ARRAY('Low walk-in rates for admissions', 'No digital lead generation system', 'High cost per admission through traditional methods', 'Unable to track marketing ROI'),
 JSON_ARRAY('Parents actively searching on Google and social media', 'Targeted ads can reach specific demographics', 'Lead forms reduce friction for inquiries', 'Retargeting keeps your school top of mind'),
 JSON_ARRAY('Predictable flow of admission inquiries', 'Lower cost per lead vs traditional marketing', 'Clear ROI tracking for every rupee spent', 'Scalable lead generation system'));

-- Real Estate
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('real_estate', 'Real Estate', 'smm',
 'Real estate buyers spend significant time researching properties online before scheduling site visits. A strong social media presence builds project awareness and generates quality leads.',
 JSON_ARRAY('Low site visits for new projects', 'Low quality lead generation', 'High competition in digital space', 'Difficulty in building project credibility'),
 JSON_ARRAY('Buyers actively research on social media', 'Video walkthroughs generate high engagement', 'Location-based targeting is highly effective', 'User testimonials drive trust'),
 JSON_ARRAY('Better lead quality from social media', 'More project enquiries and site visits', 'Stronger brand positioning vs competitors', 'Higher conversion from enquiry to visit')),

('real_estate', 'Real Estate', 'performance_marketing',
 'Performance marketing in real estate delivers measurable results — qualified leads that convert to site visits and bookings. With the right funnel strategy, you can predictably generate leads at scale.',
 JSON_ARRAY('Low site visits despite high ad spend', 'Poor lead quality from generic campaigns', 'No structured follow-up process', 'High cost per qualified lead'),
 JSON_ARRAY('High-intent searches for properties daily', 'Location-specific targeting available', 'Video ads have high engagement for real estate', 'Lead qualification via forms reduces wasted visits'),
 JSON_ARRAY('Qualified leads with verified budgets', 'Increased site visit bookings', 'Lower cost per qualified lead', 'Predictable monthly lead pipeline')),

('real_estate', 'Real Estate', 'seo',
 'When potential buyers search for properties in your area, your projects need to appear first. SEO creates a sustainable pipeline of high-intent organic leads.',
 JSON_ARRAY('Not visible for local property searches', 'Competitors dominating search results', 'No content strategy for buyer journey', 'Project pages not optimized'),
 JSON_ARRAY('High purchase-intent searches happening daily', 'Local SEO drives quality leads', 'Content marketing builds authority', 'Long-term organic traffic reduces ad dependency'),
 JSON_ARRAY('Top rankings for project-related searches', 'Consistent organic lead flow', 'Reduced cost per acquisition over time', 'Established domain authority'));

-- Restaurant & Hospitality
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('restaurant', 'Restaurant & Hospitality', 'smm',
 'In the food and hospitality industry, visual content is king. Customers discover restaurants through social media, and a strong presence directly translates to footfall and orders.',
 JSON_ARRAY('Low footfall during weekdays', 'Not appearing in local food searches', 'Low engagement on existing social pages', 'Difficulty standing out among competitors'),
 JSON_ARRAY('Food content has highest engagement rates', 'Instagram reels/stories drive discovery', 'Local hashtags and geotags are powerful', 'User-generated content builds authenticity'),
 JSON_ARRAY('Increased daily footfall and orders', 'Higher engagement and follower growth', 'Strong local brand recognition', 'More online orders and reservations')),

('restaurant', 'Restaurant & Hospitality', 'performance_marketing',
 'Performance marketing helps restaurants reach nearby hungry customers at the right time. Targeted ads drive footfall, online orders, and event bookings.',
 JSON_ARRAY('Inconsistent footfall and revenue', 'No system for driving weekday traffic', 'High competition for food delivery apps', 'Unable to promote events effectively'),
 JSON_ARRAY('Location-based ads reach nearby customers', 'Time-of-day targeting for meal times', 'Special offers drive immediate action', 'Event promotions can go viral locally'),
 JSON_ARRAY('Increased footfall especially on weekdays', 'More online orders and bookings', 'Higher event attendance', 'Predictable monthly customer acquisition'));

-- Clothing & Fashion
INSERT INTO proposal_industry_blocks (industry_key, industry_name, service_key, executive_summary, challenges, opportunities, expected_outcomes) VALUES
('fashion', 'Clothing & Fashion', 'smm',
 'Fashion is inherently visual and social. Your target audience discovers and shops through Instagram, influencers, and trending content. A strategic social media presence directly drives sales.',
 JSON_ARRAY('Low brand awareness in target demographic', 'Inconsistent content and posting', 'Not leveraging influencer marketing', 'Poor visual content quality'),
 JSON_ARRAY('Fashion content performs exceptionally on Instagram', 'Influencer collaborations drive quick results', 'Reels and stories showcase products effectively', 'User-generated content builds trust'),
 JSON_ARRAY('Increased brand awareness and followers', 'Higher website traffic and conversions', 'Stronger brand identity and positioning', 'Direct sales from social media')),

('fashion', 'Clothing & Fashion', 'performance_marketing',
 'Performance marketing for fashion brands delivers measurable ROI through targeted campaigns that reach your ideal customer profile with the right products at the right time.',
 JSON_ARRAY('High cost per acquisition', 'Low return on ad spend (ROAS)', 'No retargeting strategy', 'Difficulty scaling beyond current revenue'),
 JSON_ARRAY('Detailed targeting by interests and behavior', 'Dynamic product ads for catalog', 'Retargeting recovers abandoned carts', 'Lookalike audiences for scaling'),
 JSON_ARRAY('Improved ROAS above 3x', 'Lower cost per purchase', 'Increased monthly revenue', 'Scalable ad system with predictable returns'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- PERSONA BLOCKS (Personal Branding)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_persona_blocks (persona_key, persona_name, positioning, audience, content_strategy, expected_outcomes) VALUES
('doctor', 'Doctor',
 'Position as a trusted medical expert and thought leader in your specialty. Build authority through educational content that helps patients make informed health decisions.',
 'Health-conscious individuals, patients seeking reliable medical information, potential patients in your specialty area, medical community peers.',
 'Educational health tips, myth-busting content, patient success stories (with consent), behind-the-scenes of medical practice, FAQ answering sessions, live Q&A on health topics.',
 JSON_ARRAY('Increased patient appointments', 'Recognized as thought leader in specialty', 'Speaking and media opportunities', 'Stronger patient trust before first visit')),

('lawyer', 'Lawyer',
 'Position as an approachable legal expert who simplifies complex legal matters. Build trust through educational content that demonstrates expertise without intimidation.',
 'Individuals and businesses seeking legal guidance, potential clients in your practice area, professionals needing legal awareness, corporate decision-makers.',
 'Legal awareness posts, common legal mistakes to avoid, case study insights (anonymized), legal news commentary, rights awareness content, FAQ sessions.',
 JSON_ARRAY('Increased client inquiries', 'Recognized as go-to expert in practice area', 'Speaking and panel opportunities', 'Referral network growth')),

('entrepreneur', 'Entrepreneur',
 'Position as an innovative business leader and industry disruptor. Share your journey, insights, and lessons to build a personal brand that attracts opportunities.',
 'Aspiring entrepreneurs, investors, potential business partners, industry peers, media, talent looking to join innovative companies.',
 'Business journey storytelling, lessons learned, industry insights, team culture showcase, milestone celebrations, thought leadership on industry trends.',
 JSON_ARRAY('Investment and partnership opportunities', 'Media features and speaking invites', 'Talent attraction for company', 'Industry authority and influence')),

('business_owner', 'Business Owner',
 'Position as a reliable business leader who delivers results. Build brand awareness through personal credibility that drives trust in your business.',
 'Potential customers, business community, employees and recruits, industry partners, local community.',
 'Business insights and tips, customer success stories, team appreciation, industry knowledge sharing, behind-the-scenes, community involvement.',
 JSON_ARRAY('Increased business inquiries through personal brand', 'Stronger trust and credibility', 'Better talent attraction', 'Partnership and collaboration opportunities')),

('consultant', 'Consultant',
 'Position as a results-driven expert who solves specific business problems. Demonstrate expertise through case studies, insights, and thought leadership.',
 'Business owners seeking consulting services, corporate decision-makers, industry peers, event organizers, media.',
 'Framework and methodology sharing, client result stories, industry analysis, problem-solving content, live workshops, book/resource recommendations.',
 JSON_ARRAY('Consistent client pipeline', 'Premium pricing justification', 'Speaking and workshop opportunities', 'Book or course launch potential')),

('coach', 'Coach',
 'Position as a transformational guide who helps people achieve specific outcomes. Build trust through vulnerability, client results, and actionable insights.',
 'Individuals seeking personal/professional growth, corporate HR for training programs, event organizers, aspiring coaches, media.',
 'Transformation stories, daily motivation, coaching framework snippets, client testimonials, live coaching demonstrations, challenge-based content.',
 JSON_ARRAY('Full coaching roster', 'Group program launches', 'Speaking and workshop bookings', 'Course or product sales'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- SAMPLE CASE STUDIES
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_case_studies (title, client_name, industry_key, service_key, situation, what_we_did, results, metrics) VALUES
('Rosemount International Preschool', 'Rosemount International Preschool', 'education', 'smm',
 'New preschool with zero online presence. No social media, no website traffic, and low awareness among parents in the area.',
 'Complete social media setup and management. Created engaging content showcasing school facilities, activities, and student experiences. Ran targeted Meta ads for admission inquiries.',
 '45 new admissions in 3 months. Built a community of 2000+ followers. Became the most recognized preschool brand in the locality.',
 JSON_ARRAY(JSON_OBJECT('label','Admissions','value','45 in 3 months'), JSON_OBJECT('label','Followers','value','2000+'), JSON_OBJECT('label','Reach','value','50K monthly'))),

('Pakkiri Pondy Mess', 'Pakkiri Pondy Mess', 'restaurant', 'smm',
 'Traditional mess with great food but no online visibility. Depended entirely on word-of-mouth. Low weekday footfall.',
 'Built Instagram presence with food photography and reels. Created viral content around their signature dishes. Managed Google Business Profile for local visibility.',
 'Doubled weekday footfall within 2 months. Instagram grew to 5000+ followers. Multiple food bloggers visited organically.',
 JSON_ARRAY(JSON_OBJECT('label','Footfall Increase','value','2x in 2 months'), JSON_OBJECT('label','Instagram Followers','value','5000+'), JSON_OBJECT('label','Google Reviews','value','200+'))),

('Neelas Sarees', 'Neelas Sarees', 'fashion', 'smm',
 'Traditional saree shop wanting to reach younger audience and expand beyond local market. No online sales strategy.',
 'Created a visually stunning Instagram presence. Styled photo shoots for collections. Ran influencer collaborations and festive campaigns.',
 'Instagram grew to 10K followers. Started receiving orders from across India. 3x increase in festive season sales.',
 JSON_ARRAY(JSON_OBJECT('label','Followers','value','10K+'), JSON_OBJECT('label','Pan-India Orders','value','Started'), JSON_OBJECT('label','Festive Sales','value','3x increase')));
