-- Une branche peut avoir plusieurs passages piétons (de part et d'autre d'un terre-plein…) :
-- le passage unique devient un groupe d'un passage.
ALTER TABLE "branche" ALTER COLUMN "traversee" SET DATA TYPE geometry(MultiLineString, 4326) USING ST_Multi("traversee");
