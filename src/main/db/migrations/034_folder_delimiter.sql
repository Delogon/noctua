-- Ordneransicht: Hierarchie-Trenner je Ordner (aus LIST), damit der Renderer
-- den Baum und Anzeigenamen bauen kann, ohne den Server zu fragen.
ALTER TABLE folders ADD COLUMN delimiter TEXT;
