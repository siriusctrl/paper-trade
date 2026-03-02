import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  type AgentMixRow,
  type MarketChartRow,
  chartPalette,
  formatCompactNumber,
  formatTooltipCurrency,
} from "../lib/admin";

export const MarketCharts = ({
  marketChartData,
  agentMixData,
}: {
  marketChartData: MarketChartRow[];
  agentMixData: AgentMixRow[];
}) => {
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Market Value by Venue</CardTitle>
          <CardDescription>Top markets by current marked exposure</CardDescription>
        </CardHeader>
        <CardContent className="h-[310px]">
          {marketChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={marketChartData} margin={{ top: 10, right: 8, left: 0, bottom: 10 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(value) => formatCompactNumber(value)} tick={{ fontSize: 12 }} />
                <Tooltip formatter={formatTooltipCurrency} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {marketChartData.map((entry, index) => (
                    <Cell key={`${entry.name}-cell`} fill={chartPalette[index % chartPalette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No priced market data yet.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agent Equity Mix</CardTitle>
          <CardDescription>Equity concentration across users or agents</CardDescription>
        </CardHeader>
        <CardContent className="h-[310px]">
          {agentMixData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={agentMixData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={112} paddingAngle={2}>
                  {agentMixData.map((entry, index) => (
                    <Cell key={`${entry.name}-slice`} fill={chartPalette[index % chartPalette.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={formatTooltipCurrency} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No account equity data yet.
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};
