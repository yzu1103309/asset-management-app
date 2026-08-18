import assert from "node:assert/strict";
import test from "node:test";
import {DRAWIO_A4_MAX_EDGE, parseDrawioAreaLayout} from "../handlers/areaLayout.ts";

const mockDrawio = `
<mxfile>
  <diagram>
    <mxGraphModel pageWidth="400" pageHeight="300">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="area-1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;" value="&lt;div&gt;大桌-1&lt;/div&gt;" vertex="1">
          <mxGeometry height="60" width="120" x="20" y="30" as="geometry" />
        </mxCell>
        <mxCell id="area-2" parent="1" style="whiteSpace=wrap;html=1;" value="" vertex="1">
          <mxGeometry height="80" width="80" x="160" y="30" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

test("parses drawio vertex cells into a normalized area layout", () => {
    const layout = parseDrawioAreaLayout(mockDrawio, "mock.drawio");

    assert.equal(layout.sourceName, "mock.drawio");
    assert.deepEqual(layout.page, {width: 400, height: 300});
    assert.equal(layout.areas.length, 2);
    assert.deepEqual(layout.areas[0], {
        id: "area-1",
        name: "大桌-1",
        sourceValue: "<div>大桌-1</div>",
        style: "rounded=0;whiteSpace=wrap;html=1;",
        shape: "rectangle",
        dashed: false,
        rounded: false,
        x: 20,
        y: 30,
        width: 120,
        height: 60,
    });
    assert.equal(layout.areas[1].name, "");
});

const mockDrawioShapes = `
<mxfile>
  <diagram>
    <mxGraphModel pageWidth="800" pageHeight="600">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="solid-rect" parent="1" style="rounded=0;whiteSpace=wrap;html=1;" value="方塊" vertex="1">
          <mxGeometry height="60" width="120" x="90" y="140" as="geometry" />
        </mxCell>
        <mxCell id="dashed-rect" parent="1" style="rounded=0;whiteSpace=wrap;html=1;dashed=1;dashPattern=8 4 1 4;" value="虛線方塊" vertex="1">
          <mxGeometry height="60" width="120" x="240" y="140" as="geometry" />
        </mxCell>
        <mxCell id="ellipse-area" parent="1" style="ellipse;whiteSpace=wrap;html=1;shapeInside=1;aspect=fixed;" value="圓形" vertex="1">
          <mxGeometry height="80" width="80" x="370" y="300" as="geometry" />
        </mxCell>
        <mxCell id="square-area" parent="1" style="whiteSpace=wrap;html=1;aspect=fixed;" value="正方形" vertex="1">
          <mxGeometry height="80" width="80" x="545" y="350" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

test("normalizes drawio shape and dashed style variants", () => {
    const layout = parseDrawioAreaLayout(mockDrawioShapes, "shapes-mock.drawio");

    assert.equal(layout.areas.length, 4);
    assert.deepEqual(
        layout.areas.map((area) => ({
            id: area.id,
            name: area.name,
            shape: area.shape,
            dashed: area.dashed,
            rounded: area.rounded,
        })),
        [
            {id: "solid-rect", name: "方塊", shape: "rectangle", dashed: false, rounded: false},
            {id: "dashed-rect", name: "虛線方塊", shape: "rectangle", dashed: true, rounded: false},
            {id: "ellipse-area", name: "圓形", shape: "ellipse", dashed: false, rounded: false},
            {id: "square-area", name: "正方形", shape: "rectangle", dashed: false, rounded: false},
        ],
    );
});

test("limits imported drawio layout size to the A4 maximum edge", () => {
    const a4MaxEdgeDrawio = `
    <mxfile>
      <diagram>
        <mxGraphModel pageWidth="${DRAWIO_A4_MAX_EDGE}" pageHeight="827">
          <root>
            <mxCell id="0" />
            <mxCell id="1" parent="0" />
            <mxCell id="a4-area" parent="1" value="A4" vertex="1">
              <mxGeometry x="20" y="20" width="80" height="80" as="geometry" />
            </mxCell>
          </root>
        </mxGraphModel>
      </diagram>
    </mxfile>`;

    assert.equal(parseDrawioAreaLayout(a4MaxEdgeDrawio).page.width, DRAWIO_A4_MAX_EDGE);

    const oversizedDrawio = a4MaxEdgeDrawio.replace(
        `pageWidth="${DRAWIO_A4_MAX_EDGE}"`,
        `pageWidth="${DRAWIO_A4_MAX_EDGE + 1}"`,
    );

    assert.throws(
        () => parseDrawioAreaLayout(oversizedDrawio),
        /最大邊不可超過 A4 最大邊/,
    );
});
