SET client_encoding TO 'UTF8';

BEGIN;

UPDATE sources
   SET name = U&'Autorit\00E9 de R\00E9gulation de la Poste et des T\00E9l\00E9communications du Congo'
 WHERE code = 'arptc'
   AND position(U&'\00C3' IN name) > 0;

UPDATE categories
   SET name = U&'Mobile money et portefeuilles num\00E9riques'
 WHERE slug = 'mobile-money'
   AND position(U&'\00C3' IN name) > 0;
UPDATE categories
   SET description = U&'Services de monnaie mobile et portefeuilles num\00E9riques.'
 WHERE slug = 'mobile-money'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET description = U&'Paiements num\00E9riques aupr\00E8s des commer\00E7ants et entreprises.'
 WHERE slug = 'paiements-marchands'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET name = U&'Interop\00E9rabilit\00E9 des paiements'
 WHERE slug = 'interoperabilite'
   AND position(U&'\00C3' IN name) > 0;
UPDATE categories
   SET description = U&'Interop\00E9rabilit\00E9 entre r\00E9seaux, banques et syst\00E8mes de paiement.'
 WHERE slug = 'interoperabilite'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET name = U&'S\00E9curit\00E9 num\00E9rique et fraude'
 WHERE slug = 'securite-fraude'
   AND position(U&'\00C3' IN name) > 0;
UPDATE categories
   SET description = U&'S\00E9curit\00E9, protection des usagers et lutte contre la fraude num\00E9rique.'
 WHERE slug = 'securite-fraude'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET name = U&'R\00E9glementation et politiques financi\00E8res'
 WHERE slug = 'reglementation'
   AND position(U&'\00C3' IN name) > 0;
UPDATE categories
   SET description = U&'R\00E9glementation et politiques relatives aux paiements et services financiers.'
 WHERE slug = 'reglementation'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET name = U&'Banques, t\00E9l\00E9coms et fintechs'
 WHERE slug = 'acteurs-fintech'
   AND position(U&'\00C3' IN name) > 0;
UPDATE categories
   SET description = U&'\00C9volutions concernant les banques, op\00E9rateurs t\00E9l\00E9coms et fintechs.'
 WHERE slug = 'acteurs-fintech'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET description = U&'Innovations technologiques li\00E9es aux paiements num\00E9riques.'
 WHERE slug = 'innovations'
   AND position(U&'\00C3' IN description) > 0;

UPDATE categories
   SET name = U&'Communication digitale et \00E9ducation financi\00E8re'
 WHERE slug = 'education-financiere'
   AND position(U&'\00C3' IN name) > 0;
UPDATE categories
   SET description = U&'\00C9ducation financi\00E8re et usages num\00E9riques.'
 WHERE slug = 'education-financiere'
   AND position(U&'\00C3' IN description) > 0;

UPDATE indicators
   SET name = U&'D\00E9tention d\2019un compte financier ou usage d\2019un service de monnaie mobile'
 WHERE code = 'FX.OWN.TOTL.ZS'
   AND position(U&'\00C3' IN name) > 0;
UPDATE indicators
   SET definition = U&'Part des personnes \00E2g\00E9es de 15 ans et plus d\00E9clarant d\00E9tenir un compte dans une institution financi\00E8re ou avoir personnellement utilis\00E9 un service de monnaie mobile au cours des 12 derniers mois. Source : Global Findex, Banque mondiale.'
 WHERE code = 'FX.OWN.TOTL.ZS'
   AND position(U&'\00C3' IN definition) > 0;
UPDATE indicators
   SET unit = U&'% de la population \00E2g\00E9e de 15 ans et plus'
 WHERE code = 'FX.OWN.TOTL.ZS'
   AND position(U&'\00C3' IN unit) > 0;

UPDATE geographies
   SET name = U&'R\00E9publique d\00E9mocratique du Congo'
 WHERE code_system = 'ISO-3166-1-alpha-3'
   AND code = 'COD'
   AND position(U&'\00C3' IN name) > 0;

UPDATE source_indicator_mappings
   SET external_unit = U&'% de la population \00E2g\00E9e de 15 ans et plus'
 WHERE source_id = (SELECT id FROM sources WHERE code = 'world_bank')
   AND external_code = 'FX.OWN.TOTL.ZS'
   AND position(U&'\00C3' IN external_unit) > 0;

COMMIT;
